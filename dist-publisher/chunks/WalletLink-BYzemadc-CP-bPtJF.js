import{t as e}from"./jsx-runtime-DUE3NRXP.js";import{T as t,lt as n}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import{pn as r}from"./localBatchGatewayRequest-DH4UIsvC.js";import{t as i}from"./getFormattedUsdFromLamports-B6EqSEho-CWXnni59.js";import{n as a}from"./transaction-CnfuREWo-D7B2_ywf.js";import{i as o,n as s,o as c,t as l}from"./ethers-CCCiz19Z-x2_rGziG.js";var u=e(),d=({weiQuantities:e,tokenPrice:t,tokenSymbol:n})=>{let r=o(e),i=t?c(r,t):void 0,a=l(r,n);return(0,u.jsx)(m,{children:i||a})},f=({weiQuantities:e,tokenPrice:t,tokenSymbol:n})=>{let r=o(e),i=t?c(r,t):void 0,a=l(r,n);return(0,u.jsx)(m,{children:i?(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(h,{children:`USD`}),i===`<$0.01`?(0,u.jsxs)(_,{children:[(0,u.jsx)(g,{children:`<`}),`$0.01`]}):i]}):a})},p=({quantities:e,tokenPrice:t,tokenSymbol:n=`SOL`,tokenDecimals:o=9})=>{let s=e.reduce(((e,t)=>e+t),0n),c=t&&n===`SOL`&&o===9?i(s,t):void 0,l=n===`SOL`&&o===9?a(s):`${r(s,o)} ${n}`;return(0,u.jsx)(m,{children:c?(0,u.jsx)(u.Fragment,{children:c===`<$0.01`?(0,u.jsxs)(_,{children:[(0,u.jsx)(g,{children:`<`}),`$0.01`]}):c}):l})},m=t.span`
  font-size: 14px;
  line-height: 140%;
  display: flex;
  gap: 4px;
  align-items: center;
`,h=t.span`
  font-size: 12px;
  line-height: 12px;
  color: var(--privy-color-foreground-3);
`,g=t.span`
  font-size: 10px;
`,_=t.span`
  display: flex;
  align-items: center;
`;function v(e,t){return`https://explorer.solana.com/account/${e}?chain=${t}`}var y=e=>(0,u.jsx)(b,{href:e.chainType===`ethereum`?s(e.chainId,e.walletAddress):v(e.walletAddress,e.chainId),target:`_blank`,children:n(e.walletAddress)}),b=t.a`
  &:hover {
    text-decoration: underline;
  }
`;export{d as i,p as n,f as r,y as t};