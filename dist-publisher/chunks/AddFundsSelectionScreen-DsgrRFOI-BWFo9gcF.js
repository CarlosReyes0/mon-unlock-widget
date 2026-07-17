import{o as e}from"./chunk--c01j_DQ.js";import{u as t,w as n}from"./publisher-auth-DJHoYw-R.js";import{n as r,t as i}from"./jsx-runtime-DUE3NRXP.js";import{C as a}from"./context-krwWbq5I-VpGD_5tI.js";import{T as o,ct as s}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import"./eventemitter3-C41no9dG.js";import{t as c}from"./modal-context-E_09TxQ8-Yai1eliN.js";import{t as l}from"./createLucideIcon-DM9IPQrw.js";import{t as u}from"./credit-card-CUeQ7ukP.js";import{c as d,i as f,l as p,v as m}from"./styles-DiH1PWA8-CYnodvYv.js";import{r as h}from"./styles-DVyDvTdj-D8lVFfVL.js";var g=l(`banknote`,[[`rect`,{width:`20`,height:`12`,x:`2`,y:`6`,rx:`2`,key:`9lu3g6`}],[`circle`,{cx:`12`,cy:`12`,r:`2`,key:`1c9p78`}],[`path`,{d:`M6 12h.01M18 12h.01`,key:`113zkx`}]]),_=i(),v=e(r(),1);s();var y={component:()=>{let e=n(),{onUserCloseViaDialogOrKeybindRef:r}=c(),i=a(),o=(0,v.useRef)(!1);(0,v.useEffect)((()=>{e&&(o.current=!1)}),[e]);let s=(0,v.useCallback)((async()=>{!o.current&&e&&(o.current=!0,t(),await e.onCancel())}),[e]);return(0,v.useEffect)((()=>(r.current=s,()=>{r.current===s&&(r.current=null)})),[s,r]),e?e.error?(0,_.jsx)(d,{icon:g,iconVariant:`warning`,title:`Unable to add funds`,subtitle:e.error,showClose:!0,onClose:s,primaryCta:{label:`Close`,onClick:s}}):(0,_.jsx)(d,{icon:g,iconVariant:`subtle`,title:`Select method`,subtitle:`Choose how to fund your wallet`,showClose:!0,onClose:s,children:(0,_.jsxs)(h,{style:{marginTop:`1rem`},$colorScheme:i.appearance.palette.colorScheme,children:[e.startFiat&&(0,_.jsxs)(f,{onClick:async()=>{o.current||(o.current=!0,await e.startFiat?.())},children:[(0,_.jsx)(b,{children:(0,_.jsx)(u,{})}),(0,_.jsxs)(x,{children:[(0,_.jsx)(p,{children:`Pay with fiat`}),(0,_.jsx)(S,{children:`Apple Pay, Google Pay, or debit card`})]})]}),e.startCrypto&&(0,_.jsxs)(f,{onClick:async()=>{o.current||(o.current=!0,await e.startCrypto?.())},children:[(0,_.jsx)(b,{children:(0,_.jsx)(m,{})}),(0,_.jsxs)(x,{children:[(0,_.jsx)(p,{children:`Transfer from wallet`}),(0,_.jsx)(S,{children:`Send crypto from any wallet`})]})]})]})}):null}},b=o.span`
  width: 2rem;
  height: 2rem;
  border-radius: var(--privy-border-radius-full);
  background-color: var(--privy-color-background-2);
  color: var(--color-icon-muted, #64668b);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  svg {
    width: 1.125rem;
    height: 1.125rem;
  }
`,x=o.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`,S=o.span`
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--privy-color-foreground-3);
`;export{y as AddFundsSelectionScreen,y as default};