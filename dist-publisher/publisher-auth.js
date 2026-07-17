import{o as e}from"./chunks/chunk--c01j_DQ.js";import{Ci as t,h as n,mr as r,t as i}from"./chunks/publisher-auth-DJHoYw-R.js";import{n as a,t as o}from"./chunks/jsx-runtime-DUE3NRXP.js";var s=e(a(),1),c=t(),l=o(),u=``;function d({el:e}){e.innerHTML=`
    <div class="mon-pub-auth">
      <div class="mon-pub-auth__row">
        <button type="button" class="mon-pub-auth__btn" id="mon-pub-fallback-wallet">Connect MetaMask</button>
      </div>
      <p class="mon-pub-auth__hint">
        Email / Google sign-in is not configured (<code>VITE_PRIVY_APP_ID</code>). You can still use an injected wallet.
      </p>
    </div>
  `,e.querySelector(`#mon-pub-fallback-wallet`)?.addEventListener(`click`,()=>{window.dispatchEvent(new CustomEvent(`mon-publisher-auth-fallback-wallet`))})}function f(){let e=document.getElementById(`mon-publisher-auth`);if(e){if(!u){d({el:e});return}(0,c.createRoot)(e).render((0,l.jsx)(s.StrictMode,{children:(0,l.jsx)(n,{appId:u,config:{loginMethods:[`email`,`google`,`wallet`],appearance:{theme:`light`,accentColor:`#5b7c5a`,logo:void 0},embeddedWallets:{ethereum:{createOnLogin:`users-without-wallets`}},defaultChain:r,supportedChains:[r]},children:(0,l.jsx)(i,{variant:`inline`})})}))}}f();