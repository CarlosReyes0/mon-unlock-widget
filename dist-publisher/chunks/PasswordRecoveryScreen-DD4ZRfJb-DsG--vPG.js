import{o as e}from"./chunk--c01j_DQ.js";import{s as t}from"./publisher-auth-DJHoYw-R.js";import{n,t as r}from"./jsx-runtime-DUE3NRXP.js";import"./context-krwWbq5I-VpGD_5tI.js";import{On as i,Pn as a,Qt as o,T as s,Un as c,ct as l,w as u}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import"./eventemitter3-C41no9dG.js";import{t as d}from"./modal-context-E_09TxQ8-Yai1eliN.js";import{l as f}from"./ModalHeader-CPoYSZQh-DSLJ27ES.js";import{t as p}from"./Screen-J_oQ5CmO-Cc0JDLGZ.js";import{a as m,d as h,n as g,o as _,s as v}from"./shared-054zR7p5-BN0z6IsG.js";import{t as y}from"./ShieldCheckIcon-B26Fp9rb.js";import{a as b}from"./Layouts-BlFm53ED-D6HWC_K5.js";var x=r(),S=e(n(),1);l();var C={component:()=>{let[e,n]=(0,S.useState)(!0),{authenticated:r,user:s}=a(),{walletProxy:l,closePrivyModal:u,createAnalyticsEvent:f,client:C}=c(),{navigate:D,data:O,onUserCloseViaDialogOrKeybindRef:k}=d(),[A,j]=(0,S.useState)(void 0),[M,N]=(0,S.useState)(``),[P,F]=(0,S.useState)(!1),{entropyId:I,entropyIdVerifier:L,onCompleteNavigateTo:R,onSuccess:z,onFailure:B}=O.recoverWallet,V=(e=`User exited before their wallet could be recovered`)=>{u({shouldCallAuthOnSuccess:!1}),B(typeof e==`string`?new o(e):e)};return k.current=V,(0,S.useEffect)((()=>{if(!r)return V(`User must be authenticated and have a Privy wallet before it can be recovered`)}),[r]),(0,x.jsxs)(p,{children:[(0,x.jsx)(p.Header,{icon:y,title:`Enter your password`,subtitle:`Please provision your account on this new device. To continue, enter your recovery password.`,showClose:!0,onClose:V}),(0,x.jsx)(p.Body,{children:(0,x.jsx)(w,{children:(0,x.jsxs)(`div`,{children:[(0,x.jsxs)(m,{children:[(0,x.jsx)(_,{type:e?`password`:`text`,onChange:e=>(e=>{e&&j(e)})(e.target.value),disabled:P,style:{paddingRight:`2.3rem`}}),(0,x.jsx)(h,{style:{right:`0.75rem`},children:e?(0,x.jsx)(g,{onClick:()=>n(!1)}):(0,x.jsx)(v,{onClick:()=>n(!0)})})]}),!!M&&(0,x.jsx)(T,{children:M})]})})}),(0,x.jsxs)(p.Footer,{children:[(0,x.jsx)(p.HelpText,{children:(0,x.jsxs)(b,{children:[(0,x.jsx)(`h4`,{children:`Why is this necessary?`}),(0,x.jsx)(`p`,{children:`You previously set a password for this wallet. This helps ensure only you can access it`})]})}),(0,x.jsx)(p.Actions,{children:(0,x.jsx)(E,{loading:P||!l,disabled:!A,onClick:async()=>{F(!0);let e=await C.getAccessToken(),n=i(s,I);if(!e||!n||A===null)return V(`User must be authenticated and have a Privy wallet before it can be recovered`);try{f({eventName:`embedded_wallet_recovery_started`,payload:{walletAddress:n.address}}),await l?.recover({accessToken:e,entropyId:I,entropyIdVerifier:L,recoveryPassword:A}),N(``),R?D(R):u({shouldCallAuthOnSuccess:!1}),z?.(n),f({eventName:`embedded_wallet_recovery_completed`,payload:{walletAddress:n.address}})}catch(e){t(e)?N(`Invalid recovery password, please try again.`):N(`An error has occurred, please try again.`)}finally{F(!1)}},$hideAnimations:!I&&P,children:`Recover your account`})}),(0,x.jsx)(p.Watermark,{})]})]})}},w=s.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`,T=s.div`
  line-height: 20px;
  height: 20px;
  font-size: 13px;
  color: var(--privy-color-error);
  text-align: left;
  margin-top: 0.5rem;
`,E=s(f)`
  ${({$hideAnimations:e})=>e&&u`
      && {
        // Remove animations because the recoverWallet task on the iframe partially
        // blocks the renderer, so the animation stutters and doesn't look good
        transition: none;
      }
    `}
`;export{C as PasswordRecoveryScreen,C as default};