import{o as e}from"./chunk--c01j_DQ.js";import{Si as t,_t as n,bi as r,gt as i,ht as a,xi as o,yi as s}from"./publisher-auth-DJHoYw-R.js";import{n as c,t as l}from"./jsx-runtime-DUE3NRXP.js";import{r as u}from"./wallet-api-DpQiCJdN.js";import"./context-krwWbq5I-VpGD_5tI.js";import{r as d}from"./Error-C0yEZpNv.js";import{T as f,Un as p,ct as m,lt as ee,u as te}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import"./eventemitter3-C41no9dG.js";import{n as h,t as ne}from"./chevron-down-CAUlZkJ7.js";import{t as re}from"./modal-context-E_09TxQ8-Yai1eliN.js";import{a as g,c as ie,i as ae,t as oe}from"./floating-ui.react-dom-fFVwSdRq.js";import{a as se,c as ce,d as le,f as ue,i as de,o as fe,r as pe,s as me,t as he,u as ge}from"./floating-ui.react-D2oBTVa8.js";import{t as _}from"./createLucideIcon-DM9IPQrw.js";import{t as v}from"./check-BvEJ6K-x.js";import{t as _e}from"./hourglass-B5w2sPvV.js";import{t as ve}from"./info-B-DxQrhO.js";import{_ as y,a as b,c as x,d as ye,f as S,g as C,h as w,i as T,l as E,m as D,n as O,o as k,p as be,r as A,s as j,t as M,u as N,v as P}from"./styles-DiH1PWA8-CYnodvYv.js";import{t as F}from"./triangle-alert-D8jUXs12.js";import{l as xe}from"./ModalHeader-CPoYSZQh-DSLJ27ES.js";import{t as I}from"./ScreenLayout-CZ6F2ueW-CkbAbTy8.js";import{r as L}from"./styles-DVyDvTdj-D8lVFfVL.js";import{t as Se}from"./CopyableText-ChtfBWx4-WPmHppEi.js";import{t as Ce}from"./browser-D4jQIjE2.js";import{t as we}from"./QrCode-GD4v2DKo-CW7E5mhT.js";function R(e){return e.startsWith(`eip155:`)?`ethereum`:e.startsWith(`solana:`)?`solana`:e.startsWith(`bip122:`)?`bitcoin-segwit`:e.startsWith(`tron:`)?`tron`:void 0}async function z(e){let{user:t}=await e.privy.user.get();if(!t)return{ok:!1,error:`NOT_AUTHENTICATED`};let n=function(e,t){let n=R(e);if(!n)return;let r=t.linked_accounts.find((e=>e.type===`wallet`&&e.chain_type===n&&`address`in e&&e.address));return r&&`address`in r?r.address:void 0}(e.caip2,t);if(n)return{ok:!0,address:n};let r=R(e.caip2);if(!r)return{ok:!1,error:`UNSUPPORTED_CHAIN`};try{let t=await e.privy.fetchPrivyRoute(u,{body:{chain_type:r}});return await e.onWalletCreated?.(),{ok:!0,address:t.address}}catch{return{ok:!1,error:`REFUND_WALLET_CREATION_FAILED`}}}async function Te(e){let{user:t}=await e.privy.user.get();if(!t)throw Error(`NOT_AUTHENTICATED`);let n=e.refundAddress;if(!n){let t=await z({privy:e.privy,caip2:e.sourceChain,onWalletCreated:e.onWalletCreated});if(!t.ok)throw Error(t.error);n=t.address}return await e.privy.fetchPrivyRoute(s,{body:{source_chain:e.sourceChain,source_currency:e.sourceCurrency,destination_chain:e.destinationChain,destination_currency:e.destinationCurrency,destination_address:e.destinationAddress,refund_address:n,...e.slippageBps==null?{}:{slippage_bps:e.slippageBps}}})}function B(e,t){return Math.ceil(t/e)}function V(e){return e.status===`success`?e.result?{status:`success`,order:e.result}:{status:`timeout`}:e.status===`aborted`?{status:`aborted`,error:e.error}:{status:`timeout`,error:e.error}}async function Ee(e){return await e.privy.fetchPrivyRoute(t,{params:{order_id:e.orderId}})}async function De(e){let n=e.pollIntervalMs??2e3,i=e.timeoutMs??18e5,a=e.signal??new AbortController().signal;return V(await h({operation:async()=>{let n=await e.privy.fetchPrivyRoute(r,{params:{deposit_address_id:e.depositAddressId},query:{after:e.quoteCreatedAt}});if(n.order)return await e.privy.fetchPrivyRoute(t,{params:{order_id:n.order.id}})},until:e=>e!==void 0,delay:n,interval:n,attempts:B(n,i),signal:a}))}async function Oe(e){let n=e.pollIntervalMs??2e3,r=e.timeoutMs??18e5,i=e.signal??new AbortController().signal;return V(await h({operation:()=>e.privy.fetchPrivyRoute(t,{params:{order_id:e.orderId}}),until:e=>e.status!==`executing`,delay:n,interval:n,attempts:B(n,r),signal:i}))}async function ke(e){let t=await e.fetchPrivyRoute(o,{});return{currencies:t.currencies,chains:t.chains}}var H=Object.freeze({__proto__:null,generateDepositAddress:Te,getConfig:ke,getDeposit:Ee,resolveRefundAddress:z,waitForCompletion:Oe,waitForDeposit:De}),Ae=_(`chevron-up`,[[`path`,{d:`m18 15-6-6-6 6`,key:`153udz`}]]),je=_(`undo-2`,[[`path`,{d:`M9 14 4 9l5-5`,key:`102s5s`}],[`path`,{d:`M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11`,key:`f3b9sd`}]]),U=l(),W=e(c(),1);m(),Ce();var Me=class extends W.Component{static getDerivedStateFromError(){return{hasError:!0}}componentDidCatch(e,t){this.props.onError(e)}componentDidUpdate(e){e.resetKey!==this.props.resetKey&&this.state.hasError&&this.setState({hasError:!1})}render(){return this.state.hasError?null:this.props.children}constructor(...e){super(...e),this.state={hasError:!1}}};function Ne(e,t,n){let r=Number(e);return!Number.isFinite(r)||r===0?`1 ${t} ≈ ${e} ${n}`:r>=.01?`1 ${t} ≈ ${G(r)} ${n}`:`${G(1/r)} ${t} ≈ 1 ${n}`}function G(e){return e>=1e3?new Intl.NumberFormat(`en-US`,{maximumFractionDigits:0}).format(Math.round(e)):e>=100?new Intl.NumberFormat(`en-US`,{maximumFractionDigits:1}).format(e):e>=1?new Intl.NumberFormat(`en-US`,{maximumFractionDigits:2}).format(e):new Intl.NumberFormat(`en-US`,{maximumFractionDigits:4}).format(e)}function K(e,t){let n=Number(e);if(!Number.isFinite(n)||n===0)return e;let r=t==null?n:n/10**t;return r>=1e3?new Intl.NumberFormat(`en-US`,{maximumFractionDigits:2}).format(r):r>=1?new Intl.NumberFormat(`en-US`,{maximumFractionDigits:4}).format(r):r>=1e-4?new Intl.NumberFormat(`en-US`,{maximumFractionDigits:6}).format(r):new Intl.NumberFormat(`en-US`,{maximumSignificantDigits:4}).format(r)}function q({address:e,caip2:t,config:n}){for(let r of n.currencies){let n=r.chains.find((n=>n.caip2===t&&n.address.toLowerCase()===e.toLowerCase()));if(n)return{symbol:r.symbol.toUpperCase(),decimals:n.decimals}}return{symbol:e,decimals:void 0}}function J(e,t){return t[e]?.displayName??e}function Y(e,t){if(!e.chains[t.destinationChain])return`Unsupported destination chain: "${t.destinationChain}". Check that the chain is in CAIP-2 format (e.g. "eip155:8453") and is supported for deposit addresses.`;let n=t.destinationCurrency.toLowerCase();return e.currencies.some((e=>e.chains.some((e=>e.caip2===t.destinationChain&&e.address.toLowerCase()===n))))?null:`Unsupported destination currency "${t.destinationCurrency}" on chain "${t.destinationChain}". Check that this token address is supported on the specified chain.`}var Pe=new Set([`ROUTE_UNAVAILABLE`,`UNEXPECTED_STATE`,`TIMEOUT_WAITING_FOR_NEXT_ORDER`,`TIMEOUT_ORDER_COMPLETION`,`DEPOSIT_FAILED`,`DEPOSIT_REFUNDED`,`USER_EXITED`,`AMOUNT_TOO_LOW`,`INSUFFICIENT_LIQUIDITY`,`UNSUPPORTED_CHAIN`,`UNSUPPORTED_CURRENCY`,`UNSUPPORTED_ROUTE`,`NO_SWAP_ROUTES_FOUND`,`NO_INTERNAL_SWAP_ROUTES_FOUND`,`NO_QUOTES`,`SANCTIONED_WALLET_ADDRESS`,`REFUND_WALLET_CREATION_FAILED`,`DEPOSIT_ADDRESSES_NOT_ENABLED`,`NOT_AUTHENTICATED`]);function Fe(e){return Pe.has(e)}function X(e){return Fe(e)?e:`UNKNOWN_ERROR`}function Z(){let{params:e,setModalState:t}=n(),{privy:r}=p(),i=function(){let{privy:e,refreshSessionAndUser:t}=p();return(0,W.useCallback)(((n,r)=>r?Promise.resolve({ok:!0,address:r}):H.resolveRefundAddress({privy:e,caip2:n,onWalletCreated:t})),[e,t])}(),[a,o]=(0,W.useState)(!1);return{fetchQuote:(0,W.useCallback)((async(n,a,c)=>{if(e){o(!0);try{let o=await i(n.caip2,e.refundAddress);if(!o.ok)return void t({step:`error`,code:X(o.error)});t({step:`address`,selectedCurrency:a,selectedChain:n,availableChains:c,quote:await r.fetchPrivyRoute(s,{body:{source_chain:n.caip2,source_currency:n.currencyAddress,destination_chain:e.destinationChain,destination_currency:e.destinationCurrency,destination_address:e.destinationAddress,refund_address:o.address,...e.slippageBps==null?{}:{slippage_bps:e.slippageBps}}})})}catch(e){let n=e instanceof Error?e:Error(String(e)),r=`status`in n&&typeof n.status==`number`?n.status:void 0;t({step:`error`,code:n instanceof d&&n.code===`feature_not_enabled`?`DEPOSIT_ADDRESSES_NOT_ENABLED`:r&&r>=500?`UNKNOWN_ERROR`:X(n.message),message:n.message})}finally{o(!1)}}}),[e,r,i,t]),isFetching:a}}function Q(e,t){switch(e.status){case`completed`:return t({step:`complete`,order:e});case`refunded`:return t({step:`refunded`,order:e});case`failed`:return t({step:`failed`,order:e});case`executing`:return t({step:`processing`,order:e});default:return}}var Ie=({sourceAmount:e,sourceSymbol:t,sourceChainName:n,sourceDecimals:r,destinationAmount:i,destSymbol:a,destChainName:o,destDecimals:s,onClose:c})=>(0,U.jsx)(x,{icon:v,iconVariant:`success`,title:`Transfer complete`,subtitle:i?`Received ${K(e,r)} ${t} on ${n} and converted it to ${K(i,s)} ${a} on ${o}. Funds are available to use.`:`Your ${t} has been received and is now available in your wallet.`,showClose:!0,onClose:c,primaryCta:{label:`Done`,onClick:c},watermark:!1});function Le(){let{state:e,configData:t,close:n}=i(`complete`),{order:r}=e,{sourceSymbol:a,sourceChainName:o,sourceDecimals:s,destSymbol:c,destChainName:l,destDecimals:u}=(0,W.useMemo)((()=>{let e=q({address:r.source_currency,caip2:r.source_chain,config:t}),n=q({address:r.destination_currency,caip2:r.destination_chain,config:t});return{sourceSymbol:e.symbol,sourceChainName:J(r.source_chain,t.chains),sourceDecimals:e.decimals,destSymbol:n.symbol,destChainName:J(r.destination_chain,t.chains),destDecimals:n.decimals}}),[r,t]);return(0,U.jsx)(Ie,{sourceAmount:r.source_amount,sourceSymbol:a,sourceChainName:o,sourceDecimals:s,destinationAmount:r.destination_amount,destSymbol:c,destChainName:l,destDecimals:u,onClose:n})}function Re(){let{modalState:e,setModalState:t,config:r,retryConfig:i,close:a}=n();if(e.step!==`error`)throw Error(`UNEXPECTED_STATE`);let{code:o}=e,{title:s,subtitle:c,detail:l,iconVariant:u}=(e=>{switch(e){case`AMOUNT_TOO_LOW`:return{title:`Amount too low`,subtitle:`The deposit amount is below the minimum for this route.`,detail:`Try a larger amount or a different token.`,iconVariant:`warning`};case`INSUFFICIENT_LIQUIDITY`:return{title:`Insufficient liquidity`,subtitle:`There isn't enough liquidity for this route right now.`,detail:`Try a smaller amount or a different network.`,iconVariant:`warning`};case`UNSUPPORTED_CHAIN`:return{title:`Unsupported chain`,subtitle:`Deposits from this chain type aren't supported yet. Try a different network.`,iconVariant:`warning`};case`UNSUPPORTED_CURRENCY`:case`UNSUPPORTED_ROUTE`:case`ROUTE_UNAVAILABLE`:case`NO_SWAP_ROUTES_FOUND`:case`NO_INTERNAL_SWAP_ROUTES_FOUND`:case`NO_QUOTES`:return{title:`Route not available`,subtitle:`This deposit route isn't supported right now. Try a different token or network.`,iconVariant:`warning`};case`SANCTIONED_WALLET_ADDRESS`:return{title:`Address restricted`,subtitle:`This address cannot be used for deposits due to compliance restrictions.`,iconVariant:`warning`};case`REFUND_WALLET_CREATION_FAILED`:return{title:`Unable to set up refund address`,subtitle:`We couldn't create a wallet to receive refunds on this chain. Please try again or select a different network.`,iconVariant:`warning`};case`DEPOSIT_ADDRESSES_NOT_ENABLED`:return{title:`Not enabled`,subtitle:`Deposit addresses are not enabled for this app.`,iconVariant:`warning`};case`NOT_AUTHENTICATED`:return{title:`Not signed in`,subtitle:`Please sign in to continue with your deposit.`,iconVariant:`warning`};case`TIMEOUT_WAITING_FOR_NEXT_ORDER`:case`TIMEOUT_ORDER_COMPLETION`:return{title:`Taking longer than expected`,subtitle:`Your funds are safe. The deposit is still being processed — check back later.`,iconVariant:`subtle`};default:return{title:`Something went wrong`,subtitle:`We couldn't complete your request. Please try again.`,iconVariant:`subtle`}}})(o),[d,f]=(0,W.useState)(!1);return(0,U.jsx)(x,{icon:F,iconVariant:u,title:s,subtitle:l?`${c} ${l}`:c,showClose:!0,onClose:a,primaryCta:{label:`Try again`,onClick:async()=>{if(r.status!==`ready`){f(!0);try{await i(),t({step:`token`})}catch{f(!1)}}else t({step:`token`})},loading:d},watermark:!0})}function ze(){let{state:e,close:t}=i(`failed`),{order:n}=e;return(0,U.jsx)(I,{icon:F,iconVariant:`error`,title:`Transfer failed`,subtitle:`Something went wrong processing your transfer.`,showClose:!0,onClose:t,primaryCta:{label:`Done`,onClick:t},secondaryCta:{label:`Learn about manual recovery`,onClick:()=>window.open(`https://docs.privy.io`,`_blank`,`noopener,noreferrer`)},watermark:!0,children:(0,U.jsxs)(Be,{href:n.tracking_url,target:`_blank`,rel:`noopener noreferrer`,children:[`Reference: `,n.provider_request_id]})})}var Be=f.a`
  text-align: center;
  font-size: 0.75rem;
  opacity: 0.7;
  text-decoration: underline;
  cursor: pointer;
  color: var(--privy-color-foreground-3);
`;function Ve(){let{close:e,setModalState:t,config:r,params:i,onBack:a}=n(),[o,s]=(0,W.useState)(!1);return(0,W.useEffect)((()=>{if(o&&i){if(r.status===`ready`){let e=Y(r.data,i);t(e?{step:`error`,code:`ROUTE_UNAVAILABLE`,message:e}:{step:`token`})}r.status===`error`&&t({step:`error`,code:`ROUTE_UNAVAILABLE`})}}),[o,r,i,t]),(0,U.jsx)(x,{icon:P,iconVariant:`subtle`,title:`Add funds`,subtitle:`Top up your account by sending crypto from any wallet. Conversion and routing handled by Relay.`,showClose:!0,onClose:e,showBack:!!a,onBack:a,primaryCta:{label:`Continue`,onClick:()=>{if(r.status===`ready`&&i){let e=Y(r.data,i);t(e?{step:`error`,code:`ROUTE_UNAVAILABLE`,message:e}:{step:`token`})}else r.status===`error`?t({step:`error`,code:`ROUTE_UNAVAILABLE`}):s(!0)},loading:o&&r.status===`loading`,loadingText:null},watermark:!0})}function He(){let{state:e,setModalState:t,close:r}=i(`network`),[o,s]=(0,W.useState)(-1),{availableChains:c}=e,{confirm:l,isFetching:u}=function(){let e=a(),{params:t}=n(),{fetchQuote:r,isFetching:i}=Z();return{confirm:(0,W.useCallback)((async n=>{if(!n||!t)return;let i=e?.modalState;i&&i.step===`network`&&await r(n,i.selectedCurrency,i.availableChains)}),[t,e,r]),isFetching:i}}();return(0,U.jsx)(I,{title:`Select network`,eyebrow:(0,U.jsxs)(`span`,{style:{display:`flex`,alignItems:`center`,gap:`0.375rem`},children:[(0,U.jsx)(`img`,{src:e.selectedCurrency.logoURI,alt:``,style:{width:`1rem`,height:`1rem`,borderRadius:`50%`}}),`Send `,e.selectedCurrency.symbol]}),showBack:!0,onBack:()=>t({step:`token`}),showClose:!0,onClose:r,watermark:!0,children:(0,U.jsx)(L,{style:{marginTop:`1rem`,height:`22rem`},$colorScheme:`light`,children:c.map(((e,t)=>(0,U.jsxs)(T,{$selected:o===t,disabled:u,onClick:()=>{s(t),l(e)},children:[(0,U.jsx)(D,{src:e.iconUrl,alt:e.displayName}),(0,U.jsx)(E,{children:e.displayName}),u&&t===o&&(0,U.jsx)(y,{})]},e.caip2)))})})}var Ue=({trackingUrl:e,onClose:t})=>(0,U.jsx)(I,{icon:_e,iconVariant:`subtle`,title:`Transfer in progress`,subtitle:`Your deposit was received and the transfer is now processing.`,showClose:!0,onClose:t,secondaryCta:{label:`View on block explorer ↗`,onClick:()=>window.open(e,`_blank`,`noopener,noreferrer`)},watermark:!1,children:(0,U.jsxs)(N,{children:[(0,U.jsxs)(k,{children:[(0,U.jsx)(S,{$status:`done`,children:(0,U.jsx)(v,{size:14,color:`var(--privy-color-icon-success)`,strokeWidth:2})}),(0,U.jsx)(b,{children:`Deposit received`})]}),(0,U.jsx)(C,{}),(0,U.jsxs)(k,{children:[(0,U.jsx)(S,{$status:`active`,children:(0,U.jsx)(We,{})}),(0,U.jsx)(b,{children:`Bridging`})]}),(0,U.jsx)(C,{}),(0,U.jsxs)(k,{children:[(0,U.jsx)(S,{$status:`pending`}),(0,U.jsx)(b,{children:`Funds arrived`})]})]})}),We=f.span`
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid var(--privy-color-foreground-3);
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin 1s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;function Ge(){let{state:e,close:t}=i(`processing`);return function({orderId:e,enabled:t}){let{privy:r}=p(),{setModalState:i}=n();(0,W.useEffect)((()=>{let t=new AbortController;return H.waitForCompletion({privy:r,orderId:e,signal:t.signal}).then((e=>{t.signal.aborted||(e.status===`success`?Q(e.order,i):e.status===`timeout`&&i({step:`error`,code:`TIMEOUT_ORDER_COMPLETION`}))})),()=>{t.abort()}}),[t,e,r,i])}({orderId:e.order.id,enabled:!0}),(0,U.jsx)(Ue,{trackingUrl:e.order.tracking_url,onClose:t})}function Ke(){let{state:e,close:t}=i(`refunded`),{order:n}=e;return(0,U.jsx)(x,{icon:je,iconVariant:`subtle`,title:`Transfer refunded`,subtitle:`Your transfer was received, but the swap couldn't be completed. A refund has been started automatically.`,showClose:!0,onClose:t,primaryCta:{label:`Done`,onClick:t},secondaryCta:{label:`View transaction details`,onClick:()=>window.open(n.tracking_url,`_blank`,`noopener,noreferrer`)},watermark:!0})}function qe(){let{close:e,setModalState:t,config:r}=n(),{confirm:i,currencies:a,isFetching:o}=function(){let{config:e,setModalState:t}=n(),{fetchQuote:r,isFetching:i}=Z(),a=e.status===`ready`?e.data.currencies:[];return{confirm:(0,W.useCallback)((async n=>{if(e.status!==`ready`||!n)return;let i=function(e,t){return e.chains.map((e=>{let n=t.chains[e.caip2];return n?{caip2:e.caip2,displayName:n.displayName,iconUrl:n.iconUrl,vmType:n.vmType,currencyAddress:e.address,currencyDecimals:e.decimals}:null})).filter((e=>e!==null))}(n,e.data);if(i.length!==1)t({step:`network`,selectedCurrency:n,availableChains:i});else{let e=i[0];await r(e,n,i)}}),[e,r,t]),currencies:a,isFetching:i}}(),[s,c]=(0,W.useState)(-1);return(0,U.jsx)(I,{title:`Select token`,showBack:!0,onBack:()=>t({step:`intro`}),showClose:!0,onClose:e,watermark:!0,children:r.status===`error`?(0,U.jsx)(A,{children:(0,U.jsx)(ye,{children:`Failed to load tokens`})}):r.status===`loading`?(0,U.jsx)(A,{children:(0,U.jsx)(te,{})}):(0,U.jsx)(L,{style:{marginTop:`1rem`,height:`22rem`},$colorScheme:`light`,children:a.map(((e,t)=>(0,U.jsxs)(T,{$selected:s===t,disabled:o,onClick:()=>{c(t),i(e)},children:[(0,U.jsx)(M,{src:e.logoURI,alt:e.symbol}),(0,U.jsx)(E,{children:e.name}),o&&t===s?(0,U.jsx)(y,{}):(0,U.jsx)(be,{children:e.symbol})]},e.symbol)))})})}function Je({address:e,onClick:t}){let[n,r]=(0,W.useState)(!1);return(0,U.jsx)(U.Fragment,{children:n?(0,U.jsx)(Ye,{onClick:()=>r(!1),style:{marginTop:`1.5rem`},children:(0,U.jsx)(we,{url:e,size:312,hideLogo:!0})}):(0,U.jsxs)(Xe,{title:`Click to copy address`,onClick:t,style:{marginTop:`1.5rem`},children:[(0,U.jsxs)(Ze,{children:[(0,U.jsx)(Qe,{children:`Deposit address`}),(0,U.jsx)($e,{children:e})]}),(0,U.jsx)(et,{children:(0,U.jsx)(tt,{type:`button`,onClick:e=>{e.stopPropagation(),r(!0)},children:(0,U.jsx)(P,{size:16,color:`var(--privy-color-icon-muted)`})})})]})})}var Ye=f.div`
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`,Xe=f.div`
  display: flex;
  border-radius: var(--privy-border-radius-md);
  background: var(--privy-color-background-clicked, #f1f2f9);
  padding: 1rem;
  cursor: pointer;
  gap: 0.5rem;
`,Ze=f.div`
  flex: 1;
  min-width: 0;
  text-align: left;
`,Qe=f.div`
  font-size: 0.75rem;
  color: var(--privy-color-icon-muted);
  line-height: 1rem;
  margin-bottom: 0.25rem;
`,$e=f.div`
  word-break: break-all;
  font-size: 0.875rem;
  font-family: ui-monospace, monospace;
  font-weight: 500;
  line-height: 1.375rem;
  color: var(--privy-color-foreground);
`,et=f.div`
  width: 1.5rem;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: 0.25rem;
`,tt=f.button`
  && {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    outline: none;
    box-shadow: none;
    border-radius: var(--privy-border-radius-xs);

    &:hover {
      background: var(--privy-color-background);
    }

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }
  }
`;function nt({quote:e,selectedCurrency:t,selectedChain:n,destinationSymbol:r}){let[i,a]=(0,W.useState)(!1),o=t.symbol.toUpperCase(),s=n.displayName,c=(0,W.useRef)(null);return(0,U.jsxs)(rt,{children:[(0,U.jsxs)(it,{onClick:(0,W.useCallback)((()=>{let e=document.getElementById(`privy-modal-content`);e&&(c.current&&clearTimeout(c.current),e.style.transition=`none`,c.current=setTimeout((()=>{e.style.transition=``,c.current=null}),160)),a((e=>!e))}),[]),children:[(0,U.jsxs)(at,{children:[t.logoURI&&(0,U.jsx)(M,{src:t.logoURI,alt:o,style:{width:`2rem`,height:`2rem`}}),n.iconUrl&&(0,U.jsx)(ot,{src:n.iconUrl,alt:s})]}),(0,U.jsxs)(st,{children:[(0,U.jsx)(ct,{children:`You send`}),(0,U.jsxs)($,{children:[o,` on `,s]})]}),(0,U.jsx)(lt,{children:(0,U.jsx)(i?Ae:ne,{size:16})})]}),(0,U.jsx)(pt,{$expanded:i,children:(0,U.jsx)(mt,{children:(0,U.jsxs)(ut,{children:[e.indicative_rate&&(0,U.jsxs)(w,{children:[(0,U.jsx)(j,{children:`Conversion rate`}),(0,U.jsxs)(O,{style:{display:`flex`,alignItems:`center`,gap:`0.25rem`},children:[Ne(e.indicative_rate,o,r.toUpperCase()),(0,U.jsx)(ht,{content:`Estimated rate based on current market conditions. Final execution price may vary depending on transfer size and routing.`})]})]}),(0,U.jsxs)(w,{children:[(0,U.jsx)(j,{children:`Max slippage`}),(0,U.jsxs)(O,{children:[(e.slippage_bps/100).toFixed(1),`%`]})]}),(0,U.jsxs)(w,{children:[(0,U.jsx)(j,{children:`Refund address`}),(0,U.jsx)(O,{children:(0,U.jsx)(Se,{value:e.refund_address,iconOnly:!0,iconSize:11,children:ee(e.refund_address,4,4)})})]})]})})}),(0,U.jsxs)(dt,{children:[(0,U.jsx)(F,{size:16,color:`var(--privy-color-icon-muted)`,style:{flexShrink:0}}),(0,U.jsxs)(ft,{children:[`Only send `,(0,U.jsx)(`strong`,{children:o}),` on `,(0,U.jsx)(`strong`,{children:s}),`. Other assets may be lost.`]})]})]})}var rt=f.div`
  border-radius: var(--privy-border-radius-md);
  border: 1px solid var(--privy-color-foreground-4);
  overflow: hidden;
`,it=f.button`
  && {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--privy-color-foreground);
    outline: none;
    box-shadow: none;

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }
  }
`,at=f.span`
  position: relative;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
`,ot=f(D)`
  && {
    position: absolute;
    top: -0.125rem;
    right: -0.25rem;
    width: 0.75rem;
    height: 0.75rem;
    box-sizing: content-box;
    border: 1.5px solid #fff;
    background-color: #fff;
  }
`,st=f.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`,ct=f.span`
  font-size: 0.75rem;
  color: var(--privy-color-foreground-3);
  line-height: 1rem;
`,$=f.span`
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
`,lt=f.span`
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--privy-border-radius-full);
  background-color: var(--privy-color-background-clicked, #f1f2f9);
  color: var(--privy-color-foreground-3);
`,ut=f.div`
  display: flex;
  flex-direction: column;
  padding: 0 1rem 0.75rem;

  & > * {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--privy-color-foreground-4);
  }

  & > *:last-child {
    border-bottom: none;
  }
`,dt=f.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0.75rem 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--privy-border-radius-sm);
  background: #f8f9fc;
`,ft=f.span`
  font-size: 0.8125rem;
  line-height: 1.25rem;
  color: var(--privy-color-icon-muted);
  text-align: left;
`,pt=f.div`
  display: grid;
  grid-template-rows: ${({$expanded:e})=>e?`1fr`:`0fr`};
  transition: grid-template-rows 150ms ease-out;
`,mt=f.div`
  overflow: hidden;
`;function ht({content:e}){let[t,n]=(0,W.useState)(!1),{refs:r,floatingStyles:i,context:a}=fe({open:t,onOpenChange:n,placement:`top`,whileElementsMounted:ie,middleware:[ae(6),oe(),g({padding:8})]}),{getReferenceProps:o,getFloatingProps:s}=ge([ce(a,{move:!1,handleClose:pe()}),me(a),de(a),se(a),le(a,{role:`tooltip`})]),{isMounted:c,styles:l}=ue(a,{duration:150});return(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(`button`,{ref:r.setReference,type:`button`,"aria-label":`More information about conversion rate`,style:{display:`inline-flex`,alignItems:`center`,justifyContent:`center`,padding:0,border:`none`,background:`none`,color:`var(--privy-color-icon-muted)`,cursor:`pointer`},...o(),children:(0,U.jsx)(ve,{size:14})}),c&&(0,U.jsx)(he,{root:document.getElementById(`privy-modal-content`)??void 0,children:(0,U.jsx)(gt,{ref:r.setFloating,style:{...i,...l},...s(),children:e})})]})}var gt=f.div`
  max-width: 13rem;
  padding: 0.5rem 0.625rem;
  border-radius: var(--privy-border-radius-sm, 0.375rem);
  background: var(--privy-color-foreground);
  color: var(--privy-color-background);
  font-size: 0.6875rem;
  line-height: 1rem;
  font-weight: 400;
  text-align: left;
  z-index: 10;
`,_t=({quote:e,selectedCurrency:t,selectedChain:n,destinationSymbol:r,onBack:i,onClose:a})=>{let[o,s]=(0,W.useState)(!1),c=t?.symbol?.toUpperCase()??`funds`,l=n?.displayName??``,u=async()=>{o||(await navigator.clipboard.writeText(e.deposit_address),s(!0),setTimeout((()=>s(!1)),2e3))};return(0,U.jsxs)(I,{title:`Send ${c}${l?` on ${l}`:``}`,subtitle:`Send funds to the address below. Conversion and routing handled by Relay.`,showBack:!0,onBack:i,showClose:!0,onClose:a,watermark:!1,children:[(0,U.jsx)(nt,{quote:e,selectedCurrency:t,selectedChain:n,destinationSymbol:r}),(0,U.jsx)(Je,{address:e.deposit_address,onClick:u}),(0,U.jsx)(xe,{style:{marginTop:`1rem`,marginBottom:`0.5rem`,...o?{backgroundColor:`var(--privy-color-icon-success)`,borderColor:`var(--privy-color-icon-success)`}:{}},onClick:u,children:o?(0,U.jsxs)(U.Fragment,{children:[`Copied `,(0,U.jsx)(v,{size:16,style:{marginLeft:`0.25rem`}})]}):`Copy address`}),(0,U.jsx)(vt,{children:`Routing and bridging are handled by Relay. Privy does not control execution timing, liquidity, or transaction outcomes.`})]})},vt=f.p`
  && {
    margin: 0.5rem 0 0;
    font-size: 0.6875rem;
    line-height: 1.125rem;
    color: var(--privy-color-icon-muted);
    text-align: center;
  }
`;function yt(){let{state:e,configData:t,setModalState:r,close:a,params:o}=i(`address`),{quote:s,selectedCurrency:c,selectedChain:l,availableChains:u}=e;return function({depositAddressId:e,enabled:t,quoteCreatedAt:r}){let{privy:i}=p(),{setModalState:a}=n();(0,W.useEffect)((()=>{if(!e)return;let t=new AbortController;return H.waitForDeposit({privy:i,depositAddressId:e,quoteCreatedAt:r,signal:t.signal}).then((e=>{t.signal.aborted||(e.status===`success`?Q(e.order,a):e.status===`timeout`&&a({step:`error`,code:`TIMEOUT_WAITING_FOR_NEXT_ORDER`}))})),()=>{t.abort()}}),[t,e,i,r,a])}({depositAddressId:s.id,enabled:!0,quoteCreatedAt:s.created_at}),(0,U.jsx)(_t,{quote:s,selectedCurrency:c,selectedChain:l,destinationSymbol:(0,W.useMemo)((()=>q({address:o.destinationCurrency,caip2:o.destinationChain,config:t}).symbol),[o,t]),onBack:()=>r({step:`network`,selectedCurrency:c,availableChains:u}),onClose:a})}function bt(){let{modalState:e,setModalState:t}=n();return(0,U.jsx)(Me,{onError:e=>t({step:`error`,code:`UNEXPECTED_STATE`,message:e.message}),resetKey:e.step,children:(0,U.jsx)(xt,{})})}function xt(){let{modalState:e}=n();switch(e.step){case`intro`:return(0,U.jsx)(Ve,{});case`token`:return(0,U.jsx)(qe,{});case`network`:return(0,U.jsx)(He,{});case`address`:return(0,U.jsx)(yt,{});case`processing`:return(0,U.jsx)(Ge,{});case`complete`:return(0,U.jsx)(Le,{});case`refunded`:return(0,U.jsx)(Ke,{});case`failed`:return(0,U.jsx)(ze,{});case`error`:return(0,U.jsx)(Re,{});default:return null}}var St={component:()=>{let{onUserCloseViaDialogOrKeybindRef:e}=re(),t=a(),{close:r,config:i}=n();return(0,W.useEffect)((()=>{e.current=r}),[e,r]),(0,W.useEffect)((()=>{if(i.status===`ready`){for(let e of i.data.currencies)new Image().src=e.logoURI;for(let e of Object.values(i.data.chains))new Image().src=e.iconUrl}}),[i]),t?(0,U.jsx)(bt,{}):null}};export{St as default};