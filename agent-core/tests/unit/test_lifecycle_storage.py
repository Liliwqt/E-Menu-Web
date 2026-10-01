from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from cryptography.fernet import Fernet
import pytest
from touchorders_core.api.lifecycle_storage import PrivateLifecycleStorage

class Blob:
    def __init__(self, bucket, name):
        self.bucket, self.name = bucket, name
        self.generation = 1
        self.time_created = datetime.now(timezone.utc)
    def exists(self): return self.name in self.bucket.data
    def reload(self): pass
    def upload_from_string(self, value, **kwargs): self.bucket.data[self.name] = value
    def download_as_bytes(self): return self.bucket.data[self.name]
    def delete(self, **kwargs): self.bucket.data.pop(self.name, None)

class Bucket:
    def __init__(self):
        self.data, self.blobs = {}, {}
        self.iam_configuration = SimpleNamespace(uniform_bucket_level_access_enabled=True,public_access_prevention='enforced')
        self.versioning_enabled = False
        self.soft_delete_policy = SimpleNamespace(retention_duration_seconds=0)
        self.retention_period = None
        self.lifecycle_rules = [{'action':{'type':'Delete'},'condition':{'age':30}}]
    def reload(self): pass
    def get_iam_policy(self, **kwargs): return SimpleNamespace(bindings=[])
    def blob(self, name):
        return self.blobs.setdefault(name, Blob(self,name))
    def list_blobs(self): return [b for n,b in self.blobs.items() if n in self.data]


def test_objects_are_encrypted_and_expire_by_prefix():
    bucket = Bucket()
    store = PrivateLifecycleStorage(bucket, Fernet.generate_key())
    store.put('exports/test', b'customer-data')
    store.put('backups/test', b'backup-data')
    assert b'customer-data' not in bucket.data['exports/test']
    assert store.get('exports/test') == b'customer-data'
    now = datetime.now(timezone.utc)
    bucket.blobs['exports/test'].time_created = now-timedelta(days=2)
    bucket.blobs['backups/test'].time_created = now-timedelta(days=29)
    store.expire(int(now.timestamp()*1000))
    assert 'exports/test' not in bucket.data
    assert 'backups/test' in bucket.data
    bucket.blobs['backups/test'].time_created = now-timedelta(days=31)
    store.expire(int(now.timestamp()*1000))
    assert not bucket.data


@pytest.mark.parametrize('setting,value', [('versioning_enabled',True),('retention_period',86400)])
def test_unsafe_retention_settings_reject_storage(setting, value):
    bucket = Bucket(); setattr(bucket, setting, value)
    with pytest.raises(ValueError): PrivateLifecycleStorage(bucket, Fernet.generate_key()).put('exports/test',b'x')


def test_soft_delete_and_missing_expiry_reject_storage():
    bucket = Bucket(); bucket.soft_delete_policy.retention_duration_seconds=604800
    store = PrivateLifecycleStorage(bucket,Fernet.generate_key())
    with pytest.raises(ValueError): store.verify_configuration()
    bucket.soft_delete_policy.retention_duration_seconds=0
    bucket.lifecycle_rules=[]
    with pytest.raises(ValueError): store.verify_configuration()


def test_expired_objects_cannot_be_downloaded_even_before_physical_cleanup():
    from fastapi import HTTPException
    bucket = Bucket(); store = PrivateLifecycleStorage(bucket,Fernet.generate_key())
    store.put('exports/test',b'data')
    bucket.blobs['exports/test'].time_created = datetime.now(timezone.utc)-timedelta(days=2)
    with pytest.raises(HTTPException): store.get('exports/test')
    assert 'exports/test' in bucket.data


def test_daily_encrypted_backup_restores_with_current_tombstones():
    import copy
    import json
    from test_lifecycle import Database, C, B
    from touchorders_core.api.lifecycle import purge_branch
    from touchorders_core.api.lifecycle_storage import restore_snapshot
    db = Database()
    bucket = Bucket()
    store = PrivateLifecycleStorage(bucket, Fernet.generate_key())
    now = int(datetime.now(timezone.utc).timestamp()*1000)
    name = store.backup(db, now)
    assert b'company-checkout' not in bucket.data[name]
    saved = bucket.data[name]
    current = copy.deepcopy(db.data)
    purge_branch(current, C, B, now, 'fixture-operator')
    restored = restore_snapshot(json.loads(store.get(name)), current)
    assert C not in restored
    assert 'owner' not in restored.get('accounts', {})
    assert 'device-one' not in restored.get('kioskEnrollments', {})
    assert restored['lifecycleMaintenance']['enabled'] is True
    db.data = current
    assert store.backup(db, now) == name
    assert bucket.data[name] == saved  # never overwrite the same daily backup
