(function () {
"use strict";

var user = null;
var cart = [];
var sales = [];
var orders = [];
var pendingBrand = "";
var paymentOrderId = "";
var paymentOptions = [];

var brands = [
  ["Apple", "$10 - $200", "Apple", "●"],
  ["Amazon", "$10 - $200", "Amazon", "a"],
  ["Walmart", "$10 - $200", "Walmart", "✦"],
  ["Google Play", "$10 - $100", "Google-Play", "▶"],
  ["Steam", "$10 - $100", "Steam", "S"],
  ["Visa", "$25 - $500", "Visa", "V"],
  ["Netflix", "$15 - $100", "Netflix", "N"],
  ["Spotify", "$10 - $100", "Spotify", "●"],
  ["Xbox", "$10 - $100", "Xbox", "X"],
  ["PlayStation", "$10 - $200", "PlayStation", "PS"],
  ["Target", "$10 - $200", "Target", "◎"],
  ["eBay", "$10 - $200", "eBay", "e"],
  ["Uber", "$10 - $200", "Uber", "U"],
  ["Airbnb", "$25 - $500", "Airbnb", "A"],
  ["Nike", "$10 - $250", "Nike", "✓"],
  ["Roblox", "$10 - $100", "Roblox", "R"],
  ["Discord", "$10 - $100", "Discord", "D"]
];

function $(id) { return document.getElementById(id); }
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function headers() {
  var h = {"Content-Type":"application/json"};
  if (user && user.token) h.Authorization = "Bearer " + user.token;
  return h;
}
function request(url, options) {
  options = options || {};
  var h = headers();
  if (options.headers) Object.keys(options.headers).forEach(function(k){h[k]=options.headers[k];});
  options.headers = h;
  return fetch(url, options).then(function(r){
    return r.text().then(function(text){
      var data = {};
      try { data = text ? JSON.parse(text) : {}; } catch(e) {}
      if (!r.ok) throw new Error(data.error || data.message || "Request failed.");
      return data;
    });
  });
}
function post(url, data) {
  return request(url, {method:"POST", body:JSON.stringify(data || {})});
}
function get(url) { return request(url); }

window.goHome = function(){ window.scrollTo({top:0,behavior:"smooth"}); };
window.scrollToId = function(id){ var el=$(id); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); };
window.focusSearch = function(){ scrollToId("cards"); setTimeout(function(){ $("searchInput").focus(); },300); };
window.openModal = function(id){ $(id).classList.add("open"); };
window.closeModal = function(id){ $(id).classList.remove("open"); };
window.openLogin = function(){ openModal("loginModal"); };
window.openHelp = function(){ openModal("helpModal"); };
window.openSell = function(){ if(!user){openLogin();toast("Please verify your email and sign in first.");return;} scrollToId("sellSection"); };
window.openSales = function(){ if(!user){openLogin();toast("Please sign in to view My Sales.");return;} scrollToId("salesSection"); loadSales(); };
window.openOrders = function(){ if(!user){openLogin();toast("Please sign in to view My Orders.");return;} scrollToId("ordersSection"); loadOrders(); };

function toast(message) {
  var old=$("toast");
  if(!old){old=document.createElement("div");old.id="toast";old.style.cssText="position:fixed;left:50%;bottom:25px;transform:translateX(-50%);z-index:900;background:#151b29;border:1px solid #51329a;color:#fff;padding:13px 18px;border-radius:10px;box-shadow:0 10px 35px #0008;font-size:13px;";document.body.appendChild(old);}
  old.textContent=message; old.style.display="block";
  clearTimeout(window.__cardoraToast);
  window.__cardoraToast=setTimeout(function(){old.style.display="none";},3000);
}

function renderCards() {
  var q=String($("searchInput").value || "").toLowerCase().trim();
  var list=brands.filter(function(b){return b[0].toLowerCase().indexOf(q)!==-1;});
  $("giftCards").innerHTML=list.map(function(b){
    return '<div class="gift"><div class="gift-art art-'+b[2]+'"><b>'+esc(b[0])+'</b><i>'+esc(b[3])+'</i></div><h3>'+esc(b[0])+' Gift Card</h3><div class="range">'+esc(b[1])+'</div><button class="buy" onclick="buyVoucher(\''+esc(b[0]).replace(/'/g,"&#39;")+'\',\''+esc(b[1]).replace(/'/g,"&#39;")+'\')">Buy Now</button></div>';
  }).join("");
  if(!list.length) $("giftCards").innerHTML='<div class="empty" style="grid-column:1/-1">No gift cards found.</div>';
}
window.filterCards=renderCards;

function fillBrands() {
  $("sellBrand").innerHTML='<option value="">Choose brand</option>'+brands.map(function(b){return '<option value="'+esc(b[0])+'">'+esc(b[0])+'</option>';}).join("");
}
window.buyVoucher=function(brand,range){
  if(!user){openLogin();toast("Please sign in before buying.");return;}
  cart.push({brand:brand,range:range});
  updateCart();toast(brand+" added to your cart.");
};
function updateCart(){ $("cartCount").textContent=String(cart.length); }
window.openCart=function(){renderCart();openModal("cartModal");};
function renderCart(){
  var box=$("cartItems");
  if(!cart.length){box.innerHTML='<div class="empty">Your cart is empty.</div>';return;}
  box.innerHTML=cart.map(function(x,i){return '<div style="display:flex;justify-content:space-between;gap:10px;padding:14px 0;border-bottom:1px solid #222c3d"><div><strong>'+esc(x.brand)+'</strong><br><small style="color:#9aa5b5">'+esc(x.range)+'</small></div><button class="secondary" style="padding:8px 11px" onclick="removeCart('+i+')">Remove</button></div>';}).join("");
}
window.removeCart=function(i){cart.splice(i,1);updateCart();renderCart();};

window.signup=function(){
  var email=$("loginEmail").value.trim(), pass=$("loginPassword").value, st=$("authStatus");
  if(!email||!pass){st.className="status error";st.textContent="Enter your email and password.";return;}
  st.className="status";st.textContent="Creating account and sending your code...";
  post("/api/signup",{email:email,password:pass}).then(function(j){st.className="status success";st.textContent=j.message;}).catch(function(e){st.className="status error";st.textContent=e.message;});
};
window.resendCode=function(){
  var email=$("loginEmail").value.trim(), st=$("authStatus");
  if(!email){st.className="status error";st.textContent="Enter your email first.";return;}
  post("/api/resend-code",{email:email}).then(function(j){st.className="status success";st.textContent=j.message;}).catch(function(e){st.className="status error";st.textContent=e.message;});
};
window.verifyEmail=function(){
  var email=$("loginEmail").value.trim(), code=$("verifyCode").value.trim(), st=$("authStatus");
  if(!email||!code){st.className="status error";st.textContent="Enter your email and 6-digit code.";return;}
  post("/api/verify",{email:email,code:code}).then(function(j){
    user=j.user;localStorage.setItem("cardora-user",JSON.stringify(user));updateAuth();closeModal("loginModal");toast("Email verified. You are signed in.");loadSales();loadOrders();
  }).catch(function(e){st.className="status error";st.textContent=e.message;});
};
window.login=function(){
  var email=$("loginEmail").value.trim(), pass=$("loginPassword").value, st=$("authStatus");
  if(!email||!pass){st.className="status error";st.textContent="Enter your email and password.";return;}
  post("/api/login",{email:email,password:pass}).then(function(j){
    user=j.user;localStorage.setItem("cardora-user",JSON.stringify(user));updateAuth();closeModal("loginModal");toast("Signed in successfully.");loadSales();loadOrders();
  }).catch(function(e){st.className="status error";st.textContent=e.message;});
};
window.logout=function(){
  var p=user ? post("/api/logout",{}) : Promise.resolve();
  p.catch(function(){}).then(function(){user=null;localStorage.removeItem("cardora-user");updateAuth();renderSales();renderOrders();toast("Signed out.");});
};
function updateAuth(){
  $("signButton").textContent=user ? "Sign Out" : "Sign In";
  $("signButton").onclick=user ? window.logout : window.openLogin;
  $("salesHint").textContent=user ? user.email : "Sign in to view your submissions";
}
$("sellForm").addEventListener("submit",function(e){
  e.preventDefault();
  if(!user){openLogin();return;}
  var payload={brand:$("sellBrand").value,amount:Number($("sellValue").value),code:$("voucherCode").value.trim(),payoutMethod:$("payoutCrypto").value,wallet:$("payoutWallet").value.trim()};
  var st=$("sellStatus");
  if(!payload.brand||!payload.amount||!payload.code||!payload.payoutMethod||!payload.wallet){st.className="status error";st.textContent="Complete all fields.";return;}
  st.className="status";st.textContent="Submitting...";
  post("/api/sell",payload).then(function(j){
    st.className="status success";st.textContent=j.message+" Submission ID: "+j.submission.submissionId;
    $("sellForm").reset();loadSales();
  }).catch(function(e){st.className="status error";st.textContent=e.message;});
});

window.startCheckout=function(){
  if(!user){closeModal("cartModal");openLogin();toast("Please sign in before checkout.");return;}
  if(!cart.length){toast("Your cart is empty.");return;}
  pendingBrand=cart[0].brand;$("checkoutTitle").textContent="Buying "+pendingBrand+" Gift Card";$("checkoutAmount").value="";$("checkoutCrypto").value="";$("checkoutStatus").textContent="";updateCheckoutFee();closeModal("cartModal");openModal("checkoutModal");
};
window.updateCheckoutFee=function(){
  var a=Number($("checkoutAmount").value||0);
  if(a>0){var fee=Math.round((a*.03+.50)*100)/100;var total=Math.round((a+fee)*100)/100;$("checkoutFee").textContent="Voucher: $"+a.toFixed(2)+" + buyer fee $"+fee.toFixed(2)+" = $"+total.toFixed(2)+" total."; }
  else $("checkoutFee").textContent="Buyer fee: 3% + $0.50. Seller payout: 78% of face value.";
};
function loadPaymentOptions(){
  return get("/api/payment-options").then(function(j){paymentOptions=j.options||[];}).catch(function(){paymentOptions=[];});
}
window.createOrder=function(){
  var amount=Number($("checkoutAmount").value), key=$("checkoutCrypto").value, st=$("checkoutStatus");
  if(!amount||amount<=0||!key){st.className="status error";st.textContent="Enter a valid amount and choose a cryptocurrency.";return;}
  st.className="status";st.textContent="Creating order...";
  post("/api/orders",{brand:pendingBrand,amount:amount}).then(function(j){
    paymentOrderId=j.order.id;
    return loadPaymentOptions().then(function(){
      var opt=paymentOptions.find(function(x){return x.key===key;});
      if(!opt) throw new Error("Payment option unavailable.");
      $("payLabel").textContent=opt.label;$("payNetwork").textContent=opt.network;$("payAddress").textContent=opt.address;$("payTotal").textContent="Order total: $"+Number(j.order.totalUsd).toFixed(2)+" USD";$("txHash").value="";$("paymentStatus").textContent="";
      closeModal("checkoutModal");openModal("paymentModal");
    });
  }).catch(function(e){st.className="status error";st.textContent=e.message;});
};
window.copyAddress=function(){navigator.clipboard.writeText($("payAddress").textContent).then(function(){toast("Address copied.");}).catch(function(){toast("Copy failed. Select the address and copy it.");});};
window.submitPayment=function(){
  var key=$("checkoutCrypto").value, tx=$("txHash").value.trim(), st=$("paymentStatus");
  if(!tx){st.className="status error";st.textContent="Enter the transaction hash.";return;}
  post("/api/orders/"+encodeURIComponent(paymentOrderId)+"/payment",{crypto:key,txHash:tx}).then(function(j){st.className="status success";st.textContent=j.message;cart=[];updateCart();loadOrders();}).catch(function(e){st.className="status error";st.textContent=e.message;});
};

function loadSales(){
  if(!user){renderSales();return;}
  get("/api/my-sales").then(function(j){sales=j.sales||[];renderSales();}).catch(function(e){if(e.message.indexOf("sign in")!==-1) logout();});
}
function renderSales(){
  var box=$("salesList");
  if(!user){box.innerHTML='<div class="empty">Sign in to view your voucher submissions.</div>';return;}
  if(!sales.length){box.innerHTML='<div class="empty">No voucher submissions yet.</div>';return;}
  box.innerHTML='<div class="row head"><span>Voucher</span><span>Value</span><span>Status</span><span>Payout</span><span>Submission ID</span></div>'+sales.map(function(s){return '<div class="row"><span><strong>'+esc(s.brand)+'</strong></span><span>$'+Number(s.amount).toFixed(2)+'</span><span><span class="pill '+statusClass(s.status)+'">'+esc(s.status)+'</span></span><span>'+esc(s.payoutMethod)+'<br><strong>$'+Number(s.payoutAmount).toFixed(2)+'</strong></span><span><strong>'+esc(s.id)+'</strong><br><small style="color:#9aa5b5">78% payout</small></span></div>';}).join("");
}
function statusClass(s){s=String(s||"").toLowerCase();return s==="approved"?"approved":s==="rejected"?"rejected":s==="sold"?"sold":"pending";}
function loadOrders(){
  if(!user){renderOrders();return;}
  get("/api/my-orders").then(function(j){orders=j.orders||[];renderOrders();}).catch(function(){});
}
function renderOrders(){
  var box=$("ordersList");
  if(!user){box.innerHTML='<div class="empty">Sign in to view your orders.</div>';return;}
  if(!orders.length){box.innerHTML='<div class="empty">No orders yet.</div>';return;}
  box.innerHTML=orders.map(function(o){
    var delivered=o.status==="delivered";
    return '<div style="padding:18px;border:1px solid #222c3d;background:#0b111c;border-radius:12px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><strong>'+esc(o.brand)+' Gift Card</strong><span class="pill '+(delivered?"approved":"pending")+'">'+esc(o.status)+'</span></div><p style="color:#9aa5b5;font-size:13px">Order '+esc(o.id)+' · Total $'+Number(o.totalUsd).toFixed(2)+'</p>'+(o.crypto?'<p style="color:#9aa5b5;font-size:13px">'+esc(o.crypto)+' — '+esc(o.paymentNetwork||"")+'</p>':"")+(delivered?'<button class="primary" onclick="viewCode(\''+esc(o.id)+'\')">🔐 View Voucher Code</button>':'<p style="color:#9aa5b5;font-size:13px">'+(o.paymentStatus==="payment_submitted"?"Payment submitted — waiting for verification.":"Complete checkout to submit payment.")+'</p>')+'</div>';
  }).join("");
}
window.viewCode=function(id){
  get("/api/my-orders/"+encodeURIComponent(id)).then(function(j){if(j.order && j.order.voucherCode){alert("Your voucher code:\\n\\n"+j.order.voucherCode);}else toast("Voucher code is not ready yet.");}).catch(function(e){toast(e.message);});
};

window.toggleAI=function(){$("aiPanel").classList.toggle("open");};
window.aiAnswer=function(type){
  var m=$("aiMessages"), text="";
  if(type==="buy") text="Sign in, choose a voucher, add it to your cart and continue to crypto checkout.";
  if(type==="sell") text="Verify your email, open Sell Vouchers, submit the brand, value, code and your payout wallet. Track it under My Sales.";
  if(type==="verify") text="Create an account, then enter the 6-digit code sent to your email. You can use Resend Code if needed.";
  if(type==="track") text="My Sales shows your Submission ID, review status and 78% payout amount.";
  if(type==="crypto") text="Checkout supports USDT TRC-20, USDC Solana, SOL Solana, BTC and ETH. Always use the exact network shown.";
  m.innerHTML+='<div class="ai-message"><strong>Cardora AI:</strong> '+esc(text)+'</div>';m.scrollTop=m.scrollHeight;
};
window.askAI=function(){
  var input=$("aiInput"), q=input.value.trim();if(!q)return;
  $("aiMessages").innerHTML+='<div class="ai-message"><strong>You:</strong> '+esc(q)+'</div>';
  var l=q.toLowerCase(),a="I can help with buying, selling, email verification, crypto checkout and tracking.";
  if(l.indexOf("sell")>=0)a="Verify your email, then submit your voucher and payout wallet in Sell Vouchers.";
  else if(l.indexOf("buy")>=0)a="Sign in, choose a gift card, add it to your cart and continue to checkout.";
  else if(l.indexOf("code")>=0||l.indexOf("verify")>=0)a="Create your account and enter the 6-digit verification code from your email.";
  else if(l.indexOf("track")>=0||l.indexOf("sale")>=0)a="Open My Sales to see your Submission ID, status and payout.";
  else if(l.indexOf("crypto")>=0)a="Cardora checkout supports USDT TRC-20, USDC Solana, SOL, BTC and ETH.";
  $("aiMessages").innerHTML+='<div class="ai-message"><strong>Cardora AI:</strong> '+esc(a)+'</div>';input.value="";$("aiMessages").scrollTop=$("aiMessages").scrollHeight;
};

function init(){
  fillBrands();renderCards();updateCart();renderSales();renderOrders();loadPaymentOptions();
  try{var saved=JSON.parse(localStorage.getItem("cardora-user")||"null");if(saved && saved.token){user=saved;updateAuth();loadSales();loadOrders();}}catch(e){localStorage.removeItem("cardora-user");}
}
init();
}());
