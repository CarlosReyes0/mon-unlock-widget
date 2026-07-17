import{o as e}from"./chunk--c01j_DQ.js";import{n as t,t as n}from"./jsx-runtime-DUE3NRXP.js";import"./context-krwWbq5I-VpGD_5tI.js";import{n as r}from"./usePrivy-DyyEMsbu-m8ihl-eQ.js";import{Gt as i,Pn as a,T as o,Un as s,Zt as c,ct as l,g as u,w as d}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import"./eventemitter3-C41no9dG.js";import{t as f}from"./modal-context-E_09TxQ8-Yai1eliN.js";import{t as p}from"./createLucideIcon-DM9IPQrw.js";import{t as m}from"./circle-check-big-CWsUqgBu.js";import{t as h}from"./fingerprint-pattern-Dw68ZOs7.js";import{t as g}from"./ScreenLayout-CZ6F2ueW-CkbAbTy8.js";import{n as _,t as v}from"./TodoList-CgrU7uwu-COIkrg-v.js";var y=p(`trash-2`,[[`path`,{d:`M10 11v6`,key:`nco0om`}],[`path`,{d:`M14 11v6`,key:`outv1u`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`,key:`miytrc`}],[`path`,{d:`M3 6h18`,key:`d0wm0j`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`,key:`e791ji`}]]),b=n(),x=e(t(),1);l();var S=({passkeys:e,name:t,isLoading:n,errorReason:r,success:i,expanded:a,onLinkPasskey:o,onUnlinkPasskey:s,onExpand:c,onBack:l,onClose:u})=>i?(0,b.jsx)(g,{title:`Passkeys updated`,icon:m,iconVariant:`success`,primaryCta:{label:`Done`,onClick:u},onClose:u,watermark:!0}):a?(0,b.jsx)(g,{icon:h,title:`Your passkeys`,onBack:l,onClose:u,watermark:!0,children:(0,b.jsx)(D,{passkeys:e,expanded:a,onUnlink:s,onExpand:c})}):(0,b.jsxs)(g,{icon:h,title:`Set up passkey verification`,subtitle:`Verify with passkey`,primaryCta:{label:`Add new passkey`,onClick:o,loading:n},onClose:u,watermark:!0,helpText:r||void 0,children:[e.length===0?(0,b.jsx)(O,{}):(0,b.jsx)(C,{children:(0,b.jsx)(D,{passkeys:e,expanded:a,onUnlink:s,onExpand:c})}),t?(0,b.jsxs)(w,{children:[(0,b.jsx)(T,{children:`New Passkey Name`}),(0,b.jsx)(E,{children:t})]}):null]}),C=o.div`
  margin-bottom: 0.75rem;
`,w=o.div`
  margin-top: 0.25rem;
`,T=o.div`
  color: var(--privy-color-foreground-2);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  margin-bottom: 0.25rem;
`,E=o.div`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  line-height: 1.25rem;
`,D=({passkeys:e,expanded:t,onUnlink:n,onExpand:r})=>{let[i,a]=(0,x.useState)([]),o=t?e.length:2;return(0,b.jsxs)(`div`,{children:[(0,b.jsx)(P,{children:`Your passkeys`}),(0,b.jsxs)(N,{children:[e.slice(0,o).map((e=>{return(0,b.jsxs)(L,{children:[(0,b.jsxs)(`div`,{children:[(0,b.jsx)(F,{children:(t=e,t.authenticatorName?t.createdWithBrowser?`${t.authenticatorName} on ${t.createdWithBrowser}`:t.authenticatorName:t.createdWithBrowser?t.createdWithOs?`${t.createdWithBrowser} on ${t.createdWithOs}`:`${t.createdWithBrowser}`:`Unknown device`)}),(0,b.jsxs)(I,{children:[`Last used:`,` `,(e.latestVerifiedAt??e.firstVerifiedAt)?.toLocaleString()??`N/A`]})]}),(0,b.jsx)(z,{disabled:i.includes(e.credentialId),onClick:()=>(async e=>{a((t=>t.concat([e]))),await n(e),a((t=>t.filter((t=>t!==e))))})(e.credentialId),children:i.includes(e.credentialId)?(0,b.jsx)(u,{}):(0,b.jsx)(y,{size:16})})]},e.credentialId);var t})),e.length>2&&!t&&(0,b.jsx)(M,{onClick:r,children:`View all`})]})]})},O=()=>(0,b.jsxs)(v,{style:{color:`var(--privy-color-foreground)`},children:[(0,b.jsx)(_,{children:`Verify with Touch ID, Face ID, PIN, or hardware key`}),(0,b.jsx)(_,{children:`Takes seconds to set up and use`}),(0,b.jsx)(_,{children:`Use your passkey to verify transactions and login to your account`})]}),k={component:()=>{let{user:e}=a(),{unlink:t}=r(),{linkWithPasskey:n,closePrivyModal:o}=s(),{data:l}=f(),u=e?.linkedAccounts.filter((e=>e.type===`passkey`)),[d,p]=(0,x.useState)(!1),[m,h]=(0,x.useState)(``),[g,_]=(0,x.useState)(!1),[v,y]=(0,x.useState)(!1);return(0,x.useEffect)((()=>{u.length===0&&y(!1)}),[u.length]),(0,b.jsx)(S,{passkeys:u,name:l?.passkeyAuthModalData?.name,isLoading:d,errorReason:m,success:g,expanded:v,onLinkPasskey:()=>{p(!0),n({name:l?.passkeyAuthModalData?.name}).then((()=>_(!0))).catch((e=>{if(e instanceof c){if(e.privyErrorCode===i.CANNOT_LINK_MORE_OF_TYPE)return void h(`Cannot link more passkeys to account.`);if(e.privyErrorCode===i.PASSKEY_NOT_ALLOWED)return void h(`Passkey request timed out or rejected by user.`)}h(`Unknown error occurred.`)})).finally((()=>{p(!1)}))},onUnlinkPasskey:async e=>(p(!0),await t({credentialId:e}).then((()=>_(!0))).catch((e=>{e instanceof c&&e.privyErrorCode===i.MISSING_MFA_CREDENTIALS?h(`Cannot unlink a passkey enrolled in MFA`):h(`Unknown error occurred.`)})).finally((()=>{p(!1)}))),onExpand:()=>y(!0),onBack:()=>y(!1),onClose:()=>o()})}},A=o.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 90px;
  border-radius: 50%;
  svg + svg {
    margin-left: 12px;
  }
  > svg {
    z-index: 2;
    color: var(--privy-color-accent) !important;
    stroke: var(--privy-color-accent) !important;
    fill: var(--privy-color-accent) !important;
  }
`,j=d`
  && {
    width: 100%;
    font-size: 0.875rem;
    line-height: 1rem;

    /* Tablet and Up */
    @media (min-width: 440px) {
      font-size: 14px;
    }

    display: flex;
    gap: 12px;
    justify-content: center;

    padding: 6px 8px;
    background-color: var(--privy-color-background);
    transition: background-color 200ms ease;
    color: var(--privy-color-accent) !important;

    :focus {
      outline: none;
      box-shadow: none;
    }
  }
`,M=o.button`
  ${j}
`,N=o.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.8rem;
  padding: 0.5rem 0rem 0rem;
  flex-grow: 1;
  width: 100%;
`,P=o.div`
  line-height: 20px;
  height: 20px;
  font-size: 1em;
  font-weight: 450;
  display: flex;
  justify-content: flex-beginning;
  width: 100%;
`,F=o.div`
  font-size: 1em;
  line-height: 1.3em;
  font-weight: 500;
  color: var(--privy-color-foreground-2);
  padding: 0.2em 0;
`,I=o.div`
  font-size: 0.875rem;
  line-height: 1rem;
  color: #64668b;
  padding: 0.2em 0;
`,L=o.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1em;
  gap: 10px;
  font-size: 0.875rem;
  line-height: 1rem;
  text-align: left;
  border-radius: 8px;
  border: 1px solid #e2e3f0 !important;
  width: 100%;
  height: 5em;
`,R=d`
  :focus,
  :hover,
  :active {
    outline: none;
  }
  display: flex;
  width: 2em;
  height: 2em;
  justify-content: center;
  align-items: center;
  svg {
    color: var(--privy-color-error);
  }
  svg:hover {
    color: var(--privy-color-foreground-3);
  }
`,z=o.button`
  ${R}
`;export{A as DoubleIconWrapper,M as LinkButton,k as LinkPasskeyScreen,k as default,S as LinkPasskeyView};