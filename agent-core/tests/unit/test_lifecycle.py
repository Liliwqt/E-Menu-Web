import copy
import io
import threading
import time
import zipfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from touchorders_core.api.lifecycle import LifecycleService, add_months, DAY
from touchorders_core.api.lifecycle_storage import restore_snapshot
from touchorders_core.api.orders import FirebaseOrderService
from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FakeIdentityVerifier, VerifiedIdentity
from test_orders import request as order_request

C, B = 'company-checkout', 'branch-checkout'


class Reference:
    def __init__(self, db, path):
        self.db, self.parts = db, [p for p in path.split('/') if p]
    def get(self):
        value = self.db.data
        for p in self.parts:
            value = value.get(p) if isinstance(value, dict) else None
        return copy.deepcopy(value)
    def set(self, value):
        if not self.parts:
            self.db.data = copy.deepcopy(value)
            return
        current = self.db.data
        for p in self.parts[:-1]:
            current = current.setdefault(p, {})
        if value is None:
            current.pop(self.parts[-1], None)
        else:
            current[self.parts[-1]] = copy.deepcopy(value)
    def delete(self):
        self.set(None)
    def transaction(self, callback):
        with self.db.lock:
            result = callback(self.get())
            self.set(result)
            return result


class Database:
    def __init__(self):
        from test_orders import MemoryDatabase
        self.data = MemoryDatabase().data
        self.lock = threading.RLock()
        self.data[C]['companyProfile'] = {'ownerUids': {'owner': True}}
        self.data[C]['users'] = {'owner': {'email': 'owner@example.test', 'branchIds': {B: True}},
                                'manager': {'branchIds': {B: True}}, 'staff': {'branchIds': {B: True}}}
        self.data[C]['branches'][B]['users'] = {'manager': {'role': 'manager'}, 'staff': {'role': 'staff'}}
        self.data['accounts'] = {'owner': {'companyId': C, 'activeBranchId': B}}
    def reference(self, path):
        return Reference(self, path)


class Objects:
    def __init__(self): self.data = {}
    def put(self, key, value): self.data[key] = value
    def get(self, key): return self.data[key]
    def delete(self, key): self.data.pop(key, None)


class Mailer:
    def __init__(self, fail=False): self.sent = []; self.fail = fail
    def send(self, *args):
        if self.fail: raise RuntimeError('SMTP rejected')
        self.sent.append(args)


@pytest.fixture
def fixture():
    db = Database()
    now = [int(datetime(2026, 1, 31, 10, tzinfo=ZoneInfo('Asia/Manila')).timestamp()*1000)]
    api = LifecycleService(db, clock=lambda: now[0], storage=Objects(), mailer=Mailer())
    return db, now, api


def test_calendar_months_preserve_anchor_and_leap_day():
    start = int(datetime(2024, 1, 31, tzinfo=ZoneInfo('Asia/Manila')).timestamp()*1000)
    assert datetime.fromtimestamp(add_months(start, 1)/1000, ZoneInfo('Asia/Manila')).day == 29
    assert datetime.fromtimestamp(add_months(start, 2)/1000, ZoneInfo('Asia/Manila')).day == 31


def test_migration_starts_now_and_dry_run_does_not_write(fixture):
    db, now, api = fixture
    original = copy.deepcopy(db.data)
    api.run()
    assert db.data == original
    api.run(dry_run=False)
    assert api.status('owner', C, B)['lastActivityAt'] == now[0]


def test_warning_grace_only_starts_after_smtp_acceptance(fixture):
    db, now, api = fixture
    api.activity('owner', C, B)
    now[0] = add_months(now[0], 12)
    api.mailer.fail = True
    api.run(dry_run=False)
    assert api.status('owner', C, B)['status'] == 'warning_pending'
    assert 'deleteAt' not in api.status('owner', C, B)
    api.mailer.fail = False
    now[0] += DAY
    api.run(dry_run=False)
    assert api.status('owner', C, B)['deleteAt'] == add_months(now[0], 1)
    assert len(api.mailer.sent) == 1
    api.run(dry_run=False)
    assert len(api.mailer.sent) == 1


def test_activity_cancels_inactivity_grace_not_closure(fixture):
    db, now, api = fixture
    api.activity('owner', C, B)
    now[0] = add_months(now[0], 12)
    api.run(dry_run=False)
    api.activity('manager', C, B)
    assert api.status('owner', C, B)['status'] == 'active'
    api.close('owner', C)
    api.activity('manager', C, B)
    assert api.status('owner', C, B)['status'] == 'closing'


def test_passive_or_failed_operation_does_not_extend_activity(fixture):
    db, now, api = fixture
    api.activity('owner', C, B)
    before = api.status('owner', C, B)['lastActivityAt']
    now[0] += DAY
    api.activity('staff', C, B, 'operation')
    assert api.status('owner', C, B)['lastActivityAt'] == before
    db.data[C]['branches'][B]['inventory']['Drinks']['coffee']['sizes']['Medium']['stock'] = 3
    api.activity('staff', C, B, 'operation')
    assert api.status('owner', C, B)['lastActivityAt'] == now[0]
    with pytest.raises(HTTPException): api.activity('staff', C, B, 'visit')


def test_cancellation_is_atomic_idempotent_and_preserves_data(fixture):
    db, now, api = fixture
    branch = copy.deepcopy(db.data[C]['branches'][B])
    api.cancel('owner', C, B)
    api.cancel('owner', C, B)
    assert db.data['billingEntitlements'][C][B]['subscriptionStatus'] == 'cancelled'
    assert len(db.data['lifecycleAudit'][C][B]) == 1
    actual = copy.deepcopy(db.data[C]['branches'][B]); actual.pop('lifecycle', None)
    assert actual == branch
    with pytest.raises(HTTPException): api.cancel('manager', C, B)


def test_close_and_recover_preserve_subscription_and_revoked_devices(fixture):
    db, now, api = fixture
    before = copy.deepcopy(db.data['billingEntitlements'])
    api.close('owner', C)
    assert api.status('owner', C, B)['deleteAt'] == now[0] + 30*DAY
    with pytest.raises(HTTPException): FirebaseOrderService(db).submit(uid='device-one', body=order_request())
    assert not db.data[C]['branches'][B]['logs']
    assert db.data[C]['branches'][B]['inventory']['Drinks']['coffee']['sizes']['Medium']['stock'] == 2
    db.data['kioskEnrollments']['device-one']['isActive'] = False
    api.recover('owner', C)
    assert db.data['billingEntitlements'] == before
    assert db.data['kioskEnrollments']['device-one']['isActive'] is False


def test_recovery_rejected_at_deadline(fixture):
    db, now, api = fixture
    api.close('owner', C)
    now[0] += 30*DAY
    with pytest.raises(HTTPException): api.recover('owner', C)


def test_deletion_disabled_by_default(fixture):
    db, now, api = fixture
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(dry_run=False)
    assert C in db.data


def test_deletion_cleans_indexes_and_is_repeatable(fixture):
    db, now, api = fixture
    api.destructive = True
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(dry_run=False)
    assert C not in db.data
    assert 'device-one' not in db.data['kioskEnrollments']
    assert B not in db.data['billingEntitlements'][C]
    assert db.data['deletionTombstones'][C][B]['deletedAt'] == now[0]
    api.run(dry_run=False)


def test_pending_reservation_blocks_cleanup(fixture):
    db, now, api = fixture
    db.data[C]['branches'][B]['paymentReservations'] = {'order': {'status': 'pending'}}
    api.destructive = True
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(dry_run=False)
    assert api.status('owner', C, B)['status'] == 'deleting'
    assert 'order' in db.data[C]['branches'][B]['paymentReservations']
    db.data[C]['branches'][B]['paymentReservations']['order']['status'] = 'cancelled'
    api.run(dry_run=False)
    assert C not in db.data


def test_other_branch_and_shared_account_survive(fixture):
    db, now, api = fixture
    db.data[C]['branches']['branch-other'] = copy.deepcopy(db.data[C]['branches'][B])
    db.data[C]['users']['manager']['branchIds']['branch-other'] = True
    api.destructive = True
    api.close('owner', C, B)
    now[0] += 31*DAY
    api.run(branch=B, dry_run=False)
    assert 'branch-other' in db.data[C]['branches']
    assert 'manager' in db.data[C]['users']
    assert B not in db.data[C]['users']['manager']['branchIds']
    assert 'manager' not in db.data.get('lifecycleAuthCleanup', {})


def test_export_permissions_secret_exclusion_and_expiry(fixture):
    db, now, api = fixture
    db.data[C]['branches'][B]['categories']['Drinks']['coffee']['secretToken'] = 'secret'
    api.close('owner', C)
    result = api.export('owner', C)
    data = api.download('owner', result['exportId'])
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert 'manifest.json' in archive.namelist()
        assert 'secretToken' not in archive.read('business.json').decode()
        assert any(n.endswith('.csv') for n in archive.namelist())
    with pytest.raises(HTTPException): api.export('manager', C)
    with pytest.raises(HTTPException): api.download('manager', result['exportId'])
    now[0] += DAY
    with pytest.raises(HTTPException): api.download('owner', result['exportId'])
    api.run(dry_run=False)
    assert not api.storage.data


def test_restore_reapplies_tombstones_and_keeps_maintenance(fixture):
    db, now, api = fixture
    original = copy.deepcopy(db.data)
    api.destructive = True
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(dry_run=False)
    result = restore_snapshot(original, db.data)
    assert C not in result
    assert B not in result.get('billingEntitlements', {}).get(C, {})
    assert result['lifecycleMaintenance']['enabled'] is True
    assert 'device-one' not in result.get('kioskEnrollments', {})


def test_routes_require_recent_auth_and_confirm(fixture):
    db, now, api = fixture
    verifier = FakeIdentityVerifier({'old': VerifiedIdentity('owner', auth_time=1),
       'recent': VerifiedIdentity('owner', auth_time=int(time.time())), 'manager': VerifiedIdentity('manager', auth_time=int(time.time()))})
    client = TestClient(create_app(identity_verifier=verifier, lifecycle_service=api))
    body = {'companyId': C, 'branchId': B, 'confirm': True}
    assert client.post('/api/lifecycle/cancel', json=body).status_code == 401
    assert client.post('/api/lifecycle/cancel', json=body, headers={'Authorization':'Bearer old'}).status_code == 401
    assert client.post('/api/lifecycle/cancel', json=body, headers={'Authorization':'Bearer manager'}).status_code == 403
    assert client.post('/api/lifecycle/cancel', json=body, headers={'Authorization':'Bearer recent'}).status_code == 200
    assert client.post('/api/lifecycle/close', json={**body, 'confirm':False}, headers={'Authorization':'Bearer recent'}).status_code == 422


def test_shared_company_account_is_redirected_instead_of_deleted(fixture):
    db, now, api = fixture
    other = copy.deepcopy(db.data[C])
    db.data['company-other'] = other
    api.destructive = True
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(company=C, dry_run=False)
    assert db.data['accounts']['owner']['companyId'] == 'company-other'
    assert 'owner' not in db.data.get('lifecycleAuthCleanup', {})


def test_cancel_marker_survives_activity_and_recovery(fixture):
    db, now, api = fixture
    api.cancel('owner', C, B)
    api.activity('owner', C, B)
    assert db.data[C]['branches'][B]['lifecycle']['billingBlocked'] is True
    api.close('owner', C)
    api.recover('owner', C)
    assert db.data[C]['branches'][B]['lifecycle']['billingBlocked'] is True


def test_minimal_refund_hold_and_bounded_resolution(fixture):
    db, now, api = fixture
    db.data[C]['branches'][B]['logs']['refund'] = {'paymentStatus':'REFUND_PENDING','providerPaymentId':'pay_1',
        'customerName':'Do not retain', 'total':100}
    api.destructive = True
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(dry_run=False)
    hold = db.data['lifecyclePaymentHolds'][C][B]['refund']
    assert 'customerName' not in hold
    assert hold['operator'] and hold['reason']
    api.resolve_hold(C, B, 'refund', 'operator', 'Provider refund completed', release=True)
    now[0] += 30*DAY
    api.run(dry_run=False)
    assert not db.data['lifecyclePaymentHolds'][C][B]


def test_overlapping_job_is_rejected_and_dry_run_still_available(fixture):
    db, now, api = fixture
    db.data['lifecycleJobStatus'] = {'leaseId':'other','leaseUntil':now[0]+60000}
    with pytest.raises(HTTPException): api.run(dry_run=False)
    assert api.run(dry_run=True)


def test_restore_handles_business_tombstone_without_branch_markers(fixture):
    db, now, api = fixture
    snapshot = copy.deepcopy(db.data)
    result = restore_snapshot(snapshot, {'deletionTombstones':{C:{'_business':{'deletedAt':now[0]}}}})
    assert C not in result
    assert 'owner' not in result.get('accounts', {})
    assert 'device-one' not in result.get('kioskEnrollments', {})


def test_premium_insights_expire_without_an_ai_request(fixture):
    db, now, api = fixture
    db.data['premiumInsights'] = {C:{B:{'old':{'at':now[0]-91*DAY,'summary':'old'},'recent':{'at':now[0],'summary':'recent'}}}}
    api.run(dry_run=False)
    assert set(db.data['premiumInsights'][C][B]) == {'recent'}


def test_deleted_branch_revokes_existing_and_late_exports(fixture):
    db, now, api = fixture
    db.data[C]['branches']['branch-keep'] = copy.deepcopy(db.data[C]['branches'][B])
    result = api.export('owner', C)
    api.close('owner', C, B)
    api.destructive = True
    now[0] += 31*DAY
    api.run(company=C, branch=B, dry_run=False)
    with pytest.raises(HTTPException): api.download('owner', result['exportId'])
    assert not api.storage.data
    # An export uploaded just before deletion cannot regain access if its
    # metadata write arrives afterwards.
    late = '12345678-1234-1234-1234-123456789abc'
    db.data.setdefault('lifecycleExports', {})[late] = {'uid':'owner','companyId':C,'branchIds':[B], 'expiresAt':now[0]+DAY}
    with pytest.raises(HTTPException): api.download('owner', late)


def test_business_closure_promotes_existing_branch_closure(fixture):
    db, now, api = fixture
    api.close('owner', C, B)
    api.close('owner', C)
    assert api.status('owner', C, B)['closureScope'] == 'business'
    api.recover('owner', C)
    assert api.status('owner', C, B)['status'] == 'active'


def test_failed_auth_cleanup_resumes_and_preserves_other_associations(fixture):
    db, now, api = fixture
    class Auth:
        def __init__(self): self.fail = True; self.deleted = []
        def revoke_refresh_tokens(self, uid): pass
        def delete_user(self, uid):
            if self.fail: raise RuntimeError('Temporary outage')
            self.deleted.append(uid)
    api.auth = Auth()
    api.destructive = True
    api.close('owner', C)
    now[0] += 31*DAY
    api.run(dry_run=False)
    assert db.data['lifecycleAuthCleanup']
    db.data['company-other'] = {'companyProfile':{'ownerUids':{'owner':True}},'branches':{'branch-other':{'users':{}}}}
    api.auth.fail = False
    api.run(dry_run=False)
    assert 'owner' not in api.auth.deleted
    assert 'device-one' in api.auth.deleted
    assert not db.data['lifecycleAuthCleanup']


def test_late_smtp_acceptance_cannot_recreate_grace_after_activity(fixture):
    db, now, api = fixture
    api.activity('owner', C, B)
    now[0] = add_months(now[0],12)
    class LateMailer:
        def send(self, *args): api.activity('manager', C, B)
    api.mailer = LateMailer()
    api.run(dry_run=False)
    assert api.status('owner', C, B)['status'] == 'active'
    assert 'deleteAt' not in api.status('owner', C, B)


def test_expired_job_cannot_delete_after_another_worker_claims_lease(fixture):
    db, now, api = fixture
    api.close('owner', C)
    now[0] += 31*DAY
    api.destructive = True
    db.data['lifecycleJobStatus'] = {'leaseId':'new-worker','leaseUntil':now[0]+60000}
    with pytest.raises(HTTPException): api._advance(C, B, 'old-worker', 'old-worker')
    assert B in db.data[C]['branches']


def test_deletion_preview_enumerates_cleanup_without_writing(fixture):
    db, now, api = fixture
    api.close('owner', C)
    now[0] += 31*DAY
    original = copy.deepcopy(db.data)
    manifest = api.run(dry_run=True)[0]['deletionManifest']
    assert manifest['businessRemoved'] is True
    assert 'owner' in manifest['managedAccountCleanup']
    assert 'device-one' in manifest['managedAccountCleanup']
    assert manifest['recordCounts']['inventory'] > 0
    assert db.data == original


def test_background_bookkeeping_and_device_polling_are_not_activity(fixture):
    db, now, api = fixture
    api.activity('owner', C, B)
    before = api.status('owner', C, B)['lastActivityAt']
    now[0] += DAY
    value = db.data[C]['branches'][B]
    value['analytics'] = {'summary':{'totalRevenue':900}}
    value['categories']['Drinks']['coffee']['available'] = False
    value.setdefault('kiosks', {}).setdefault('device-one', {})['lastSeenAt'] = now[0]
    value['inventory']['Drinks']['coffee']['updatedAt'] = now[0]
    api.activity('staff', C, B, 'operation')
    api.run(dry_run=False)
    assert api.status('owner', C, B)['lastActivityAt'] == before
