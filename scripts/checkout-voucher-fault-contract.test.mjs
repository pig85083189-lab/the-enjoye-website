import {test} from 'node:test';
import assert from 'node:assert/strict';
// Contract model only: independent booking and finance stores, not live APIs.
function fixture(){
 const booking=new Map(), finance=new Map(), intents=new Map(); let charges=0;
 const faults={payment:false,network:false,redeem:false};
 async function checkout(id,ticket){
  if(booking.has(id))return recover(id);
  intents.set(id,ticket);
  if(faults.payment)throw Error('payment');
  booking.set(id,{id}); charges++;
  if(faults.network)throw Error('network');
  return recover(id);
 }
 async function recover(id){
  if(!booking.has(id))throw Error('not paid');
  const ticket=intents.get(id);
  if(faults.redeem)throw Error('redeem');
  if(finance.has(ticket)&&finance.get(ticket)!==id)throw Error('already used');
  finance.set(ticket,id);
  return booking.get(id);
 }
 return {checkout,recover,faults,booking,finance,charges:()=>charges};
}
test('payment failure does not consume voucher',async()=>{const f=fixture();f.faults.payment=true;await assert.rejects(f.checkout('a','v'),/payment/);assert.equal(f.finance.size,0);assert.equal(f.charges(),0);});
test('lost payment response recovers existing transaction',async()=>{const f=fixture();f.faults.network=true;await assert.rejects(f.checkout('a','v'),/network/);assert.equal(f.charges(),1);assert.equal(f.finance.size,0);await f.recover('a');assert.equal(f.finance.get('v'),'a');assert.equal(f.charges(),1);});
test('redemption failure retries without payment',async()=>{const f=fixture();f.faults.redeem=true;await assert.rejects(f.checkout('a','v'),/redeem/);assert.equal(f.finance.size,0);f.faults.redeem=false;await f.recover('a');assert.equal(f.charges(),1);assert.equal(f.finance.size,1);});
test('duplicate submission preserves one charge and redemption',async()=>{const f=fixture();await f.checkout('a','v');await f.checkout('a','v');assert.equal(f.charges(),1);assert.equal(f.finance.size,1);});
