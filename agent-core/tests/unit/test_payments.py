"""Verified QR Ph reservation and settlement contract."""
from __future__ import annotations
import copy, hashlib, hmac, json, threading, time
from uuid import uuid4
import pytest
from fastapi import HTTPException
from touchorders_core.api.orders import FirebaseOrderService
from touchorders_core.api.payments import FirebasePaymentService, PayMongoCheckout, PayMongoClient, verify_paymongo_signature
from touchorders_core.api.routes.payments import QrCheckoutRequest
COMPANY="company-checkout"; BRANCH="branch-checkout"; UID="device-one"; OWNER="owner-one"

class MemoryReference:
    def __init__(self, database, path): self.database, self.path = database, path
    def get(self):
        value=self.database.data
        for segment in filter(None,self.path.split("/")):
            value=value.get(segment) if isinstance(value,dict) else None
            if value is None: return None
        return copy.deepcopy(value)
    def set(self,value):
        with self.database.lock:
            cursor=self.database.data; segments=list(filter(None,self.path.split("/")))
            for segment in segments[:-1]: cursor=cursor.setdefault(segment,{})
            cursor[segments[-1]]=copy.deepcopy(value)
    def transaction(self,update):
        with self.database.lock:
            changed=update(self.get()); cursor=self.database.data; segments=list(filter(None,self.path.split("/")))
            for segment in segments[:-1]: cursor=cursor.setdefault(segment,{})
            cursor[segments[-1]]=copy.deepcopy(changed); return changed

class MemoryDatabase:
    def __init__(self):
        self.lock=threading.RLock()
        self.data={
          "kioskEnrollments":{UID:{"companyId":COMPANY,"branchId":BRANCH,"isActive":True}},
          "billingEntitlements":{COMPANY:{BRANCH:{"plan":"basic","subscriptionStatus":"active","periodEndAt":int(time.time()*1000)+60000}}},
          "paymentMerchantConnections":{COMPANY:{"status":"ready","accountId":"acct_child","webhookSecret":"whsec_test"}},
          COMPANY:{"companyProfile":{"ownerUids":{OWNER:True}},"branches":{BRANCH:{
            "kiosks":{UID:{"isActive":True}},
            "categories":{"Drinks":{"coffee":{"name":"Coffee","price":100,"available":True,"sizes":{"Medium":{"priceModifier":10}}}}},
            "inventory":{"Drinks":{"coffee":{"sizes":{"Medium":{"stock":2,"currentStock":2}}}}},"logs":{}}}}}
    def reference(self,path): return MemoryReference(self,path)

class FakeGateway:
    def __init__(self): self.state="awaiting_payment"; self.raise_on_create=False; self.creates=0; self.refund_state="succeeded"
    def create_qr_checkout(self,**kwargs):
        self.creates+=1
        if self.raise_on_create: raise RuntimeError("provider down")
        return PayMongoCheckout("pi_test","pm_test","data:image/png;base64,cXJwaA==",kwargs["expires_at"])
    def retrieve_intent(self,**kwargs):
        payments=[{"id":"pay_test"}] if self.state=="succeeded" else []
        return {"data":{"attributes":{"status":self.state,"payments":payments}}}
    def create_refund(self,**kwargs):
        return {"data":{"id":"ref_test","attributes":{"status":self.refund_state}}}

def request(order_id=None):
    return QrCheckoutRequest(companyId=COMPANY,branchId=BRANCH,orderId=order_id or uuid4(),customerName="Guest",expectedTotal=110,
      items=[{"categoryId":"Drinks","itemId":"coffee","size":"Medium","quantity":1,"expectedUnitPrice":110}])
def branch(db): return db.data[COMPANY]["branches"][BRANCH]
def stock(db): return branch(db)["inventory"]["Drinks"]["coffee"]["sizes"]["Medium"]["stock"]
def service():
    db=MemoryDatabase(); gateway=FakeGateway()
    return db,gateway,FirebasePaymentService(db,FirebaseOrderService(db),gateway,linked_accounts_enabled=True)

def test_paymongo_qr_contract_uses_client_key_and_payment_method_expiry():
    gateway=PayMongoClient("sk_test_parent")
    calls=[]
    responses=[
        {"data":{"id":"pi_test","attributes":{"client_key":"pi_test_client_secret"}}},
        {"data":{"id":"pm_test"}},
        {"data":{"attributes":{"next_action":{"code":{"image_url":"data:image/png;base64,cXI="}}}}},
    ]
    def fake_request(method,path,**kwargs):
        calls.append((method,path,kwargs)); return responses.pop(0)
    gateway._request=fake_request
    checkout=gateway.create_qr_checkout(
        account_id="org_child",order_id="order-test",amount_centavos=10000,
        description="Order TEST",expires_at=int(time.time()*1000)+300000,
        metadata={"order_id":"order-test"},attempt=2,
    )
    assert checkout.qr_image.startswith("data:image/png")
    assert "payment_method_options" not in calls[0][2]["payload"]["data"]["attributes"]
    assert calls[1][2]["payload"]["data"]["attributes"] == {"type":"qrph","expiry_seconds":300}
    assert calls[2][2]["payload"]["data"]["attributes"]["client_key"] == "pi_test_client_secret"
    assert calls[2][2]["idempotency_key"].endswith("order-test-2")


def test_qr_checkout_reserves_stock_once_and_returns_exact_qr():
    db,gateway,payments=service(); body=request()
    first=payments.start_checkout(uid=UID,body=body); second=payments.start_checkout(uid=UID,body=body)
    assert first["status"]=="awaiting_payment" and first["qrImage"].startswith("data:image/png")
    assert "qrImage" not in branch(db)["paymentReservations"][str(body.orderId)]
    assert db.data["paymentCheckoutSecrets"][str(body.orderId)]["qrImage"] == first["qrImage"]
    assert second==first and gateway.creates==1 and stock(db)==1 and branch(db)["logs"]=={}

def test_verified_provider_state_finalizes_order_without_second_stock_change():
    db,gateway,payments=service(); body=request(); payments.start_checkout(uid=UID,body=body); gateway.state="succeeded"
    result=payments.checkout_status(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId)); order=branch(db)["logs"][str(body.orderId)]
    assert result["status"]=="paid" and order["paymentMethod"]=="QRPH" and order["paymentStatus"]=="PAID_CONFIRMED"
    assert order["providerPaymentId"]=="pay_test" and stock(db)==1

def test_provider_failure_or_expiry_restores_stock_exactly_once():
    for mode in ("create_failure","expired"):
        db,gateway,payments=service(); body=request()
        if mode=="create_failure":
            gateway.raise_on_create=True
            with pytest.raises(RuntimeError): payments.start_checkout(uid=UID,body=body)
        else:
            payments.start_checkout(uid=UID,body=body); branch(db)["paymentReservations"][str(body.orderId)]["expiresAt"]=0
            first=payments.checkout_status(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId))
            second=payments.checkout_status(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId))
            assert first["status"]==second["status"]=="expired"
        assert stock(db)==2 and branch(db)["logs"]=={}

def test_failed_checkout_can_retry_with_a_new_provider_attempt():
    db,gateway,payments=service(); body=request(); gateway.raise_on_create=True
    with pytest.raises(RuntimeError): payments.start_checkout(uid=UID,body=body)
    assert stock(db)==2
    assert branch(db)["paymentReservations"][str(body.orderId)]["status"]=="failed"
    gateway.raise_on_create=False
    result=payments.start_checkout(uid=UID,body=body)
    reservation=branch(db)["paymentReservations"][str(body.orderId)]
    assert result["status"]=="awaiting_payment" and result["qrImage"]
    assert reservation["attempt"]==2 and gateway.creates==2 and stock(db)==1


def test_qr_payload_is_deleted_after_verified_payment():
    db,gateway,payments=service(); body=request(); payments.start_checkout(uid=UID,body=body)
    gateway.state="succeeded"
    payments.checkout_status(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId))
    assert db.data["paymentCheckoutSecrets"][str(body.orderId)] is None
    assert db.data["paymentIntentIndex"]["pi_test"] is None


def test_qr_checkout_enforces_provider_minimum_without_reserving_stock():
    db,_,payments=service(); body=request()
    menu=branch(db)["categories"]["Drinks"]["coffee"]
    menu["price"]=0.5; menu["sizes"]["Medium"]["priceModifier"]=0
    body.expectedTotal=0.5; body.items[0].expectedUnitPrice=0.5
    with pytest.raises(HTTPException) as exc: payments.start_checkout(uid=UID,body=body)
    assert exc.value.status_code==409 and stock(db)==2 and branch(db)["logs"]=={}


def test_checkout_is_disabled_without_verified_linked_merchant():
    db,_,payments=service(); db.data["paymentMerchantConnections"][COMPANY]["status"]="pending"; before=copy.deepcopy(db.data)
    with pytest.raises(HTTPException) as exc: payments.start_checkout(uid=UID,body=request())
    assert exc.value.status_code==503 and db.data==before

def test_only_owner_can_view_merchant_setup():
    db,_,payments=service()
    with pytest.raises(HTTPException) as exc: payments.merchant_status(uid=UID,company=COMPANY,branch=BRANCH)
    assert exc.value.status_code==403 and payments.merchant_status(uid=OWNER,company=COMPANY,branch=BRANCH)["available"] is True

def test_webhook_signature_checks_body_and_five_minute_freshness():
    body=json.dumps({"data":{"id":"evt_test"}},separators=(",",":")).encode(); timestamp=1_800_000_000
    digest=hmac.new(b"whsec_test",str(timestamp).encode()+b"."+body,hashlib.sha256).hexdigest(); signature=f"t={timestamp},te={digest}"
    assert verify_paymongo_signature(body,signature,"whsec_test",now_seconds=timestamp)
    assert not verify_paymongo_signature(body+b" ",signature,"whsec_test",now_seconds=timestamp)
    assert not verify_paymongo_signature(body,signature,"whsec_test",now_seconds=timestamp+301)
    live_body=json.dumps({"data":{"id":"evt_live","attributes":{"livemode":True}}},separators=(",",":")).encode()
    live_digest=hmac.new(b"whsec_test",str(timestamp).encode()+b"."+live_body,hashlib.sha256).hexdigest()
    assert verify_paymongo_signature(live_body,f"t={timestamp},te=wrong,li={live_digest}","whsec_test",now_seconds=timestamp)
    assert not verify_paymongo_signature(live_body,f"t={timestamp},te={live_digest},li=", "whsec_test",now_seconds=timestamp)


def test_owner_refund_is_idempotent_and_syncs_order_status():
    db,gateway,payments=service(); body=request(); payments.start_checkout(uid=UID,body=body); gateway.state="succeeded"
    payments.checkout_status(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId))
    first=payments.refund_order(uid=OWNER,company=COMPANY,branch=BRANCH,order_id=str(body.orderId),reason="requested_by_customer")
    second=payments.refund_order(uid=OWNER,company=COMPANY,branch=BRANCH,order_id=str(body.orderId),reason="requested_by_customer")
    assert first==second and first["status"]=="succeeded"
    assert branch(db)["logs"][str(body.orderId)]["paymentStatus"]=="REFUNDED"
    with pytest.raises(HTTPException) as exc:
        payments.refund_order(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId),reason="others")
    assert exc.value.status_code==403


def test_failed_refund_stays_retryable_and_does_not_change_paid_order():
    db,gateway,payments=service(); body=request(); payments.start_checkout(uid=UID,body=body); gateway.state="succeeded"
    payments.checkout_status(uid=UID,company=COMPANY,branch=BRANCH,order_id=str(body.orderId))
    gateway.refund_state="failed"
    result=payments.refund_order(uid=OWNER,company=COMPANY,branch=BRANCH,order_id=str(body.orderId),reason="requested_by_customer")
    assert result["status"]=="failed"
    assert branch(db)["logs"][str(body.orderId)]["paymentStatus"]=="PAID_CONFIRMED"


def test_background_sweep_reconciles_provider_before_releasing_expired_stock():
    db,gateway,payments=service(); body=request(); payments.start_checkout(uid=UID,body=body)
    branch(db)["paymentReservations"][str(body.orderId)]["expiresAt"]=0
    db.data["paymentReservationIndex"][str(body.orderId)]["expiresAt"]=0
    gateway.state="succeeded"
    assert payments.sweep_expired()==1
    assert branch(db)["logs"][str(body.orderId)]["paymentStatus"]=="PAID_CONFIRMED"
    assert stock(db)==1
