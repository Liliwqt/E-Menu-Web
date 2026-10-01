"""Local-only browser fixture server. Refuses production databases."""
import os
import time
import firebase_admin
from firebase_admin import db
from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FakeIdentityVerifier, VerifiedIdentity
from touchorders_core.api.lifecycle import LifecycleService

if os.environ.get('FIREBASE_DATABASE_EMULATOR_HOST') != '127.0.0.1:9000':
    raise RuntimeError('Fixture server requires the local RTDB emulator')
if not firebase_admin._apps:
    firebase_admin.initialize_app(options={'projectId':'demo-menu-kiosk','databaseURL':'https://demo-menu-kiosk.firebaseio.com'})
class Objects:
    def __init__(self): self.objects = {}
    def put(self, key, value): self.objects[key] = value
    def get(self, key): return self.objects[key]
    def delete(self, key): self.objects.pop(key, None)
class FixtureVerifier(FakeIdentityVerifier):
    def verify(self, token):
        from dataclasses import replace
        return replace(super().verify(token), auth_time=int(time.time()))
api = LifecycleService(db, storage=Objects())
app = create_app(identity_verifier=FixtureVerifier({role:VerifiedIdentity(role)
    for role in ('owner','manager','staff')}), lifecycle_service=api)
