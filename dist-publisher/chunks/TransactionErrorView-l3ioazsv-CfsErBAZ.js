import{o as e}from"./chunk--c01j_DQ.js";import{or as t}from"./publisher-auth-DJHoYw-R.js";import{n,t as r}from"./jsx-runtime-DUE3NRXP.js";import{C as i}from"./context-krwWbq5I-VpGD_5tI.js";import{T as a,Un as o,v as s}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import{t as c}from"./formatters-B9si3avE.js";import{An as l}from"./localBatchGatewayRequest-DH4UIsvC.js";import{i as u,l as d,o as f,p,r as m,u as h}from"./ModalHeader-CPoYSZQh-DSLJ27ES.js";import{t as ee}from"./ChevronDownIcon-DwQJhxcF.js";import{n as g,t as _}from"./Checkbox-BhNoOKjX-B-NwGRKP.js";import{t as v}from"./ExclamationCircleIcon-zVvZ61FB.js";import{t as y}from"./ErrorMessage-D8VaAP5m-C1TkzuCo.js";import{a as b,i as x,n as S,r as C,t as w}from"./Value-tcJV9e0L-tUGPRnIc.js";import{t as T}from"./LoadingSkeleton-U6-3yFwI-DxXrUl97.js";import{t as te}from"./Subtitle-CV-2yKE4-Tc_6mjm-.js";import{t as E}from"./Title-BnzYV3Is-CYflfUaW.js";import{t as D}from"./shared-FM0rljBt-CgqfrZsk.js";import{t as O}from"./Address-Bzfk1pnw-CeR2v6jn.js";import{t as k}from"./LabelXs-oqZNqbm_-DiM_uzj-.js";import{t as A}from"./WalletInfoCard-BgkZupnO-DuGY-riL.js";import{t as j}from"./WarningBanner-D5LqDt95-0iDNwnCe.js";import{t as M}from"./ErrorBanner-CQERa7bL-C9tWYn8a.js";var N=e(n());function P({title:e,titleId:t,...n},r){return N.createElement(`svg`,Object.assign({xmlns:`http://www.w3.org/2000/svg`,fill:`none`,viewBox:`0 0 24 24`,strokeWidth:1.5,stroke:`currentColor`,"aria-hidden":`true`,"data-slot":`icon`,ref:r,"aria-labelledby":t},n),e?N.createElement(`title`,{id:t},e):null,N.createElement(`path`,{strokeLinecap:`round`,strokeLinejoin:`round`,d:`m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z`}))}var ne=N.forwardRef(P),F=r();function I({title:e,titleId:t,...n},r){return N.createElement(`svg`,Object.assign({xmlns:`http://www.w3.org/2000/svg`,fill:`none`,viewBox:`0 0 24 24`,strokeWidth:1.5,stroke:`currentColor`,"aria-hidden":`true`,"data-slot":`icon`,ref:r,"aria-labelledby":t},n),e?N.createElement(`title`,{id:t},e):null,N.createElement(`path`,{strokeLinecap:`round`,strokeLinejoin:`round`,d:`M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z`}))}var L=N.forwardRef(I),re=a(w)`
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: var(--privy-color-accent);
  svg {
    fill: var(--privy-color-accent);
  }
`,R=({iconUrl:e,value:t,symbol:n,usdValue:r,nftName:i,nftCount:a,decimals:o,$isLoading:s})=>{if(s)return(0,F.jsx)(z,{$isLoading:s});let c=t&&r&&o?function(e,t,n){let r=parseFloat(e),i=parseFloat(n);if(r===0||i===0||Number.isNaN(r)||Number.isNaN(i))return e;let a=Math.ceil(-Math.log10(.01/(i/r))),o=10**(a=Math.max(a=Math.min(a,t),1)),s=+(Math.floor(r*o)/o).toFixed(a).replace(/\.?0+$/,``);return Intl.NumberFormat(void 0,{maximumFractionDigits:t}).format(s)}(t,o,r):t;return(0,F.jsxs)(`div`,{children:[(0,F.jsxs)(z,{$isLoading:s,children:[e&&(0,F.jsx)(V,{src:e,alt:`Token icon`}),a&&a>1?a+`x`:void 0,` `,i,c,` `,n]}),r&&(0,F.jsxs)(B,{$isLoading:s,children:[`$`,r]})]})},z=a.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.375rem;
  word-break: break-all;
  text-align: right;
  display: flex;
  justify-content: flex-end;

  ${T}
`,B=a.span`
  color: var(--privy-color-foreground-2);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  word-break: break-all;
  text-align: right;
  display: flex;
  justify-content: flex-end;

  ${T}
`,V=a.img`
  height: 14px;
  width: 14px;
  margin-right: 4px;
  object-fit: contain;
`,ie=e=>{let{chain:t,transactionDetails:n,isTokenContractInfoLoading:r,symbol:i}=e,{action:a,functionName:o}=n;return(0,F.jsx)(D,{children:(0,F.jsxs)(b,{children:[a!==`transaction`&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Action`}),(0,F.jsx)(S,{children:o})]}),o===`mint`&&`args`in n&&n.args.filter((e=>e)).map(((e,n)=>(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Param ${n}`}),(0,F.jsx)(S,{children:typeof e==`string`&&l(e)?(0,F.jsx)(O,{address:e,url:t?.blockExplorers?.default?.url,showCopyIcon:!1}):e?.toString()})]},n))),o===`setApprovalForAll`&&n.operator&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Operator`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:n.operator,url:t?.blockExplorers?.default?.url,showCopyIcon:!1})})]}),o===`setApprovalForAll`&&n.approved!==void 0&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Set approval to`}),(0,F.jsx)(S,{children:n.approved?`true`:`false`})]}),o===`transfer`||o===`transferWithMemo`||o===`transferFrom`||o===`safeTransferFrom`||o===`approve`?(0,F.jsxs)(F.Fragment,{children:[`formattedAmount`in n&&n.formattedAmount&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount`}),(0,F.jsxs)(S,{$isLoading:r,children:[n.formattedAmount,` `,i]})]}),`tokenId`in n&&n.tokenId&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token ID`}),(0,F.jsx)(S,{children:n.tokenId.toString()})]})]}):null,o===`safeBatchTransferFrom`&&(0,F.jsxs)(F.Fragment,{children:[`amounts`in n&&n.amounts&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amounts`}),(0,F.jsx)(S,{children:n.amounts.join(`, `)})]}),`tokenIds`in n&&n.tokenIds&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token IDs`}),(0,F.jsx)(S,{children:n.tokenIds.join(`, `)})]})]}),o===`approve`&&n.spender&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Spender`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:n.spender,url:t?.blockExplorers?.default?.url,showCopyIcon:!1})})]}),(o===`transferFrom`||o===`safeTransferFrom`||o===`safeBatchTransferFrom`)&&n.transferFrom&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Transferring from`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:n.transferFrom,url:t?.blockExplorers?.default?.url,showCopyIcon:!1})})]}),(o===`transferFrom`||o===`safeTransferFrom`||o===`safeBatchTransferFrom`)&&n.transferTo&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Transferring to`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:n.transferTo,url:t?.blockExplorers?.default?.url,showCopyIcon:!1})})]})]})})},ae=({variant:e,setPreventMaliciousTransaction:t,colorScheme:n=`light`,preventMaliciousTransaction:r})=>e===`warn`?(0,F.jsx)(H,{children:(0,F.jsxs)(j,{theme:n,children:[(0,F.jsx)(`span`,{style:{fontWeight:`500`},children:`Warning: Suspicious transaction`}),(0,F.jsx)(`br`,{}),`This has been flagged as a potentially deceptive request. Approving could put your assets or funds at risk.`]})}):e===`error`?(0,F.jsx)(F.Fragment,{children:(0,F.jsxs)(H,{children:[(0,F.jsx)(M,{theme:n,children:(0,F.jsxs)(`div`,{children:[(0,F.jsx)(`strong`,{children:`This is a malicious transaction`}),(0,F.jsx)(`br`,{}),`This transaction transfers tokens to a known malicious address. Proceeding may result in the loss of valuable assets.`]})}),(0,F.jsxs)(U,{children:[(0,F.jsx)(_,{color:`var(--privy-color-error)`,checked:!r,readOnly:!0,onClick:()=>t(!r)}),(0,F.jsx)(`span`,{children:`I understand and want to proceed anyways.`})]})]})}):null,H=a.div`
  margin-top: 1.5rem;
`,U=a.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
`,oe=({transactionIndex:e,maxIndex:t})=>typeof e!=`number`||t===0?``:` (${e+1} / ${t+1})`,se=({img:e,submitError:t,prepareError:n,onClose:r,action:a,title:o,subtitle:c,to:l,tokenAddress:f,network:g,missingFunds:_,fee:v,from:T,cta:D,disabled:k,chain:A,isSubmitting:j,isPreparing:M,isTokenPriceLoading:P,isTokenContractInfoLoading:I,isSponsored:L,symbol:z,balance:B,onClick:V,transactionDetails:H,transactionIndex:U,maxIndex:se,onBack:W,chainName:K,validation:q,hasScanDetails:J,setIsScanDetailsOpen:fe,preventMaliciousTransaction:pe,setPreventMaliciousTransaction:me,tokensSent:Y,tokensReceived:X,isScanning:he,isCancellable:ge,functionName:_e})=>{let{showTransactionDetails:Z,setShowTransactionDetails:Q,hasMoreDetails:ve,isErc20Ish:$}=(e=>{let[t,n]=(0,N.useState)(!1),r=!0,i=!1;return(!e||e.isErc20Ish||e.action===`transaction`)&&(r=!1),r&&(i=Object.entries(e||{}).some((([e,t])=>t&&![`action`,`isErc20Ish`,`isNFTIsh`].includes(e)))),{showTransactionDetails:t,setShowTransactionDetails:n,hasMoreDetails:r&&i,isErc20Ish:e?.isErc20Ish}})(H),ye=i(),be=$&&I||M||P||he;return(0,F.jsxs)(F.Fragment,{children:[(0,F.jsx)(m,{onClose:r,backFn:W}),e&&(0,F.jsx)(le,{children:e}),(0,F.jsxs)(E,{style:{marginTop:e?`1.5rem`:0},children:[o,(0,F.jsx)(oe,{maxIndex:se,transactionIndex:U})]}),(0,F.jsx)(te,{children:c}),(0,F.jsxs)(b,{style:{marginTop:`2rem`},children:[(!!Y[0]||be)&&(0,F.jsxs)(x,{children:[X.length>0?(0,F.jsx)(w,{children:`Send`}):(0,F.jsx)(w,{children:a===`approve`?`Approval amount`:`Amount`}),(0,F.jsx)(`div`,{className:`flex flex-col`,children:Y.map(((e,t)=>(0,F.jsx)(R,{iconUrl:e.iconUrl,value:_e===`setApprovalForAll`?`All`:e.value,usdValue:e.usdValue,symbol:e.symbol,nftName:e.nftName,nftCount:e.nftCount,decimals:e.decimals},t)))})]}),X.length>0&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Receive`}),(0,F.jsx)(`div`,{className:`flex flex-col`,children:X.map(((e,t)=>(0,F.jsx)(R,{iconUrl:e.iconUrl,value:e.value,usdValue:e.usdValue,symbol:e.symbol,nftName:e.nftName,nftCount:e.nftCount,decimals:e.decimals},t)))})]}),H&&`spender`in H&&H?.spender?(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Spender`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:H.spender,url:A?.blockExplorers?.default?.url})})]}):null,l&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`To`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:l,url:A?.blockExplorers?.default?.url,showCopyIcon:!0})})]}),f&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token address`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:f,url:A?.blockExplorers?.default?.url})})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Network`}),(0,F.jsx)(S,{children:g})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Estimated fee`}),(0,F.jsx)(S,{$isLoading:M||P||L===void 0,children:L?(0,F.jsxs)(ue,{children:[(0,F.jsxs)(de,{children:[`Sponsored by `,ye.name]}),(0,F.jsx)(ne,{height:16,width:16})]}):v})]}),ve&&!J&&(0,F.jsxs)(F.Fragment,{children:[(0,F.jsx)(x,{className:`cursor-pointer`,onClick:()=>Q(!Z),children:(0,F.jsxs)(C,{className:`flex items-center gap-x-1`,children:[`Details`,` `,(0,F.jsx)(ee,{style:{width:`0.75rem`,marginLeft:`0.25rem`,transform:Z?`rotate(180deg)`:void 0}})]})}),Z&&H&&(0,F.jsx)(ie,{action:a,chain:A,transactionDetails:H,isTokenContractInfoLoading:I,symbol:z})]}),J&&(0,F.jsx)(x,{children:(0,F.jsxs)(re,{onClick:()=>fe(!0),children:[(0,F.jsx)(`span`,{className:`text-color-primary`,children:`Details`}),(0,F.jsx)(p,{height:`14px`,width:`14px`,strokeWidth:`2`})]})})]}),(0,F.jsx)(s,{}),t?(0,F.jsx)(y,{style:{marginTop:`2rem`},children:t.message}):n&&U===0?(0,F.jsx)(y,{style:{marginTop:`2rem`},children:n.shortMessage??ce}):null,(0,F.jsx)(ae,{variant:q,preventMaliciousTransaction:pe,setPreventMaliciousTransaction:me}),(0,F.jsx)(G,{$useSmallMargins:!(!n&&!t&&q!==`warn`&&q!==`error`),address:T,balance:B,errMsg:M||n||t||!_?void 0:`Add funds on ${A?.name??K} to complete transaction.`}),(0,F.jsx)(d,{style:{marginTop:`1rem`},loading:j,disabled:k||M,onClick:V,children:D}),ge&&(0,F.jsx)(u,{style:{marginTop:`1rem`},onClick:r,isSubmitting:!1,children:`Not now`}),(0,F.jsx)(h,{})]})},W=({img:e,title:t,subtitle:n,cta:r,instructions:a,network:o,blockExplorerUrl:l,isMissingFunds:u,submitError:f,parseError:p,total:g,swap:_,transactingWalletAddress:v,fee:C,balance:T,disabled:D,isSubmitting:A,isPreparing:j,isTokenPriceLoading:M,onClick:P,onClose:I,onBack:L,isSponsored:R})=>{let z=j||M,[B,V]=(0,N.useState)(!1),ie=i();return(0,F.jsxs)(F.Fragment,{children:[(0,F.jsx)(m,{onClose:I,backFn:L}),e&&(0,F.jsx)(le,{children:e}),(0,F.jsx)(E,{style:{marginTop:e?`1.5rem`:0},children:t}),(0,F.jsx)(te,{children:n}),(0,F.jsxs)(b,{style:{marginTop:`2rem`,marginBottom:`.5rem`},children:[(g||z)&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount`}),(0,F.jsx)(S,{$isLoading:z,children:g})]}),_&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Swap`}),(0,F.jsx)(S,{children:_})]}),o&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Network`}),(0,F.jsx)(S,{children:o})]}),(C||z||R!==void 0)&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Estimated fee`}),(0,F.jsx)(S,{$isLoading:z,children:R&&!z?(0,F.jsxs)(ue,{children:[(0,F.jsxs)(de,{children:[`Sponsored by `,ie.name]}),(0,F.jsx)(ne,{height:16,width:16})]}):C})]})]}),(0,F.jsx)(x,{children:(0,F.jsxs)(re,{onClick:()=>V((e=>!e)),children:[(0,F.jsx)(`span`,{children:`Advanced`}),(0,F.jsx)(ee,{height:`16px`,width:`16px`,strokeWidth:`2`,style:{transition:`all 300ms`,transform:B?`rotate(180deg)`:void 0}})]})}),B&&(0,F.jsx)(F.Fragment,{children:a.map(((e,t)=>e.type===`sol-transfer`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Transfer `,e.withSeed?`with seed`:``]})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount`}),(0,F.jsxs)(S,{children:[c({amount:e.value,decimals:e.token.decimals}),` `,e.token.symbol]})]}),!!e.toAccount&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Destination`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.toAccount,url:l})})]})]},t):e.type===`spl-transfer`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Transfer `,e.token.symbol]})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount`}),(0,F.jsx)(S,{children:e.value.toString()})]}),!!e.fromAta&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Source`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.fromAta,url:l})})]}),!!e.toAta&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Destination`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.toAta,url:l})})]}),!!e.token.address&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.token.address,url:l})})]})]},t):e.type===`ata-creation`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsx)(k,{children:`Create token account`})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Program ID`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.program,url:l})})]}),!!e.owner&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Owner`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.owner,url:l})})]})]},t):e.type===`create-account`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Create account `,e.withSeed?`with seed`:``]})}),!!e.account&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Account`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.account,url:l})})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount`}),(0,F.jsxs)(S,{children:[c({amount:e.value,decimals:9}),` SOL`]})]})]},t):e.type===`spl-init-account`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsx)(k,{children:`Initialize token account`})}),!!e.account&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Account`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.account,url:l})})]}),!!e.mint&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Mint`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mint,url:l})})]}),!!e.owner&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Owner`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.owner,url:l})})]})]},t):e.type===`spl-close-account`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsx)(k,{children:`Close token account`})}),!!e.source&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Source`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.source,url:l})})]}),!!e.destination&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Destination`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.destination,url:l})})]}),!!e.owner&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Owner`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.owner,url:l})})]})]},t):e.type===`spl-sync-native`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsx)(k,{children:`Sync native`})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Program ID`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.program,url:l})})]})]},t):e.type===`raydium-swap-base-input`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Raydium swap`,` `,e.tokenIn&&e.tokenOut?`${e.tokenIn.symbol} → ${e.tokenOut.symbol}`:``]})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount in`}),(0,F.jsx)(S,{children:e.amountIn.toString()})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Minimum amount out`}),(0,F.jsx)(S,{children:e.minimumAmountOut.toString()})]}),e.mintIn&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token in`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintIn,url:l})})]}),e.mintOut&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token out`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintOut,url:l})})]})]},t):e.type===`raydium-swap-base-output`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Raydium swap`,` `,e.tokenIn&&e.tokenOut?`${e.tokenIn.symbol} → ${e.tokenOut.symbol}`:``]})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Max amount in`}),(0,F.jsx)(S,{children:e.maxAmountIn.toString()})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount out`}),(0,F.jsx)(S,{children:e.amountOut.toString()})]}),e.mintIn&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token in`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintIn,url:l})})]}),e.mintOut&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token out`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintOut,url:l})})]})]},t):e.type===`jupiter-swap-shared-accounts-route`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Jupiter swap`,` `,e.tokenIn&&e.tokenOut?`${e.tokenIn.symbol} → ${e.tokenOut.symbol}`:``]})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`In amount`}),(0,F.jsx)(S,{children:e.inAmount.toString()})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Quoted out amount`}),(0,F.jsx)(S,{children:e.quotedOutAmount.toString()})]}),e.mintIn&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token in`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintIn,url:l})})]}),e.mintOut&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token out`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintOut,url:l})})]})]},t):e.type===`jupiter-swap-exact-out-route`?(0,F.jsxs)(K,{children:[(0,F.jsx)(x,{children:(0,F.jsxs)(k,{children:[`Jupiter swap`,` `,e.tokenIn&&e.tokenOut?`${e.tokenIn.symbol} → ${e.tokenOut.symbol}`:``]})}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Quoted in amount`}),(0,F.jsx)(S,{children:e.quotedInAmount.toString()})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Amount out`}),(0,F.jsx)(S,{children:e.outAmount.toString()})]}),e.mintIn&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token in`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintIn,url:l})})]}),e.mintOut&&(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Token out`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.mintOut,url:l})})]})]},t):(0,F.jsxs)(K,{children:[(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Program ID`}),(0,F.jsx)(S,{children:(0,F.jsx)(O,{address:e.program,url:l})})]}),(0,F.jsxs)(x,{children:[(0,F.jsx)(w,{children:`Data`}),(0,F.jsx)(S,{children:e.discriminator})]})]},t)))}),(0,F.jsx)(s,{}),f?(0,F.jsx)(y,{style:{marginTop:`2rem`},children:f.message}):p?(0,F.jsx)(y,{style:{marginTop:`2rem`},children:ce}):null,(0,F.jsx)(G,{$useSmallMargins:!(!p&&!f),title:``,address:v,balance:T,errMsg:j||p||f||!u?void 0:`Add funds on Solana to complete transaction.`}),(0,F.jsx)(d,{style:{marginTop:`1rem`},loading:A,disabled:D||j,onClick:P,children:r}),(0,F.jsx)(h,{})]})},G=a(A)`
  ${e=>e.$useSmallMargins?`margin-top: 0.5rem;`:`margin-top: 2rem;`}
`,K=a(b)`
  margin-top: 0.5rem;
  border: 1px solid var(--privy-color-foreground-4);
  border-radius: var(--privy-border-radius-sm);
  padding: 0.5rem;
`,ce=`There was an error preparing your transaction. Your transaction request will likely fail.`,le=a.div`
  display: flex;
  width: 100%;
  justify-content: center;
  max-height: 40px;

  > img {
    object-fit: contain;
    border-radius: var(--privy-border-radius-sm);
  }
`,ue=a.span`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
`,de=a.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--privy-color-foreground);
`,q=e=>e?.code===t.COMPLIANCE_BLOCKED,J=()=>(0,F.jsxs)(X,{children:[(0,F.jsx)(ge,{}),(0,F.jsx)(he,{})]}),fe=({transactionError:e,chainId:t,onClose:n,onRetry:r,chainType:i,transactionHash:a})=>{let{chains:s}=o(),[c,l]=(0,N.useState)(!1),{errorCode:u,errorMessage:d}=((e,t)=>{if(t===`ethereum`)return q(e)?{errorCode:`Transaction blocked`,errorMessage:e.message}:{errorCode:e.details??e.message,errorMessage:e.shortMessage};let n=e.txSignature,r=e?.transactionMessage||`Something went wrong.`;if(Array.isArray(e.logs)){let t=e.logs.find((e=>/insufficient (lamports|funds)/gi.test(e)));t&&(r=t)}return{transactionHash:n,errorMessage:r}})(e,i),p=q(e),h=(({chains:e,chainId:t,chainType:n,transactionHash:r})=>n===`ethereum`?e.find((e=>e.id===t))?.blockExplorers?.default.url??`https://etherscan.io`:function(e,t){return`https://explorer.solana.com/tx/${e}?chain=${t}`}(r||``,t))({chains:s,chainId:t,chainType:i,transactionHash:a});return(0,F.jsxs)(F.Fragment,{children:[(0,F.jsx)(m,{onClose:n}),(0,F.jsxs)(pe,{children:[(0,F.jsx)(J,{}),(0,F.jsx)(me,{children:u}),(0,F.jsx)(Y,{children:p?`This transaction cannot be completed.`:`Please try again.`}),(0,F.jsxs)(Q,{children:[(0,F.jsx)(Z,{children:`Error message`}),(0,F.jsx)($,{$clickable:!1,children:d})]}),a&&(0,F.jsxs)(Q,{children:[(0,F.jsx)(Z,{children:`Transaction hash`}),(0,F.jsxs)(ve,{children:[`Copy this hash to view details about the transaction on a`,` `,(0,F.jsx)(`u`,{children:(0,F.jsx)(`a`,{href:h,children:`block explorer`})}),`.`]}),(0,F.jsxs)($,{$clickable:!0,onClick:async()=>{await navigator.clipboard.writeText(a),l(!0)},children:[a,(0,F.jsx)(xe,{clicked:c})]})]}),!p&&(0,F.jsx)(_e,{onClick:()=>r({resetNonce:!!a}),children:`Retry transaction`})]}),(0,F.jsx)(f,{})]})},pe=a.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`,me=a.span`
  color: var(--privy-color-foreground);
  text-align: center;
  font-size: 1.125rem;
  font-weight: 500;
  line-height: 1.25rem; /* 111.111% */
  text-align: center;
  margin: 10px;
`,Y=a.span`
  margin-top: 4px;
  margin-bottom: 10px;
  color: var(--privy-color-foreground-3);
  text-align: center;

  font-size: 0.875rem;
  font-style: normal;
  font-weight: 400;
  line-height: 20px; /* 142.857% */
  letter-spacing: -0.008px;
`,X=a.div`
  position: relative;
  width: 60px;
  height: 60px;
  margin: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
`,he=a(v)`
  position: absolute;
  width: 35px;
  height: 35px;
  color: var(--privy-color-error);
`,ge=a.div`
  position: absolute;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-color: var(--privy-color-error);
  opacity: 0.1;
`,_e=a(d)`
  && {
    margin-top: 24px;
  }
  transition:
    color 350ms ease,
    background-color 350ms ease;
`,Z=a.span`
  width: 100%;
  text-align: left;
  font-size: 0.825rem;
  color: var(--privy-color-foreground);
  padding: 4px;
`,Q=a.div`
  width: 100%;
  margin: 5px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`,ve=a.text`
  position: relative;
  width: 100%;
  padding: 5px;
  font-size: 0.8rem;
  color: var(--privy-color-foreground-3);
  text-align: left;
  word-wrap: break-word;
`,$=a.span`
  position: relative;
  width: 100%;
  background-color: var(--privy-color-background-2);
  padding: 8px 12px;
  border-radius: 10px;
  margin-top: 5px;
  font-size: 14px;
  color: var(--privy-color-foreground-3);
  text-align: left;
  word-wrap: break-word;
  ${e=>e.$clickable&&`cursor: pointer;
  transition: background-color 0.3s;
  padding-right: 45px;

  &:hover {
    background-color: var(--privy-color-foreground-4);
  }`}
`,ye=a(L)`
  position: absolute;
  top: 13px;
  right: 13px;
  width: 24px;
  height: 24px;
`,be=a(g)`
  position: absolute;
  top: 13px;
  right: 13px;
  width: 24px;
  height: 24px;
`,xe=({clicked:e})=>(0,F.jsx)(e?be:ye,{});export{W as n,fe as r,se as t};