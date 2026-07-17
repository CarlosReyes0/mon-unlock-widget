import{o as e}from"./chunk--c01j_DQ.js";import{H as t}from"./publisher-auth-DJHoYw-R.js";import{n,t as r}from"./jsx-runtime-DUE3NRXP.js";import{T as i}from"./useActiveWallet-17d8Q7cc-Bjgcw05s.js";import{t as a}from"./chevron-down-CAUlZkJ7.js";import{t as o}from"./ScreenLayout-CZ6F2ueW-CkbAbTy8.js";var s=r(),c=e(n(),1),l=({currency:e=`usd`,value:n,onChange:r,inputMode:i=`decimal`,autoFocus:a})=>{let[o,l]=(0,c.useState)(`0`),u=(0,c.useRef)(null),p=n??o,m=t[e]?.symbol??`$`,h=(0,c.useCallback)((e=>{let t=e.target.value,n=(t=t.replace(/[^\d.]/g,``)).split(`.`);n.length>2&&(t=n[0]+`.`+n.slice(1).join(``)),n.length===2&&n[1].length>2&&(t=`${n[0]}.${n[1].slice(0,2)}`),t.length>1&&t[0]===`0`&&t[1]!==`.`&&(t=t.slice(1)),(t===``||t===`.`)&&(t=`0`),r?r(t):l(t)}),[r]),g=(0,c.useCallback)((e=>{!([`Delete`,`Backspace`,`Tab`,`Escape`,`Enter`,`.`,`ArrowLeft`,`ArrowRight`,`ArrowUp`,`ArrowDown`,`Home`,`End`].includes(e.key)||(e.ctrlKey||e.metaKey)&&[`a`,`c`,`v`,`x`].includes(e.key.toLowerCase()))&&(e.key>=`0`&&e.key<=`9`||e.preventDefault())}),[]),_=(0,c.useMemo)((()=>(p.includes(`.`),p)),[p]);return(0,s.jsxs)(d,{onClick:()=>u.current?.focus(),children:[(0,s.jsx)(f,{children:m}),_,(0,s.jsx)(`input`,{ref:u,type:`text`,inputMode:i,value:_,onChange:h,onKeyDown:g,autoFocus:a,placeholder:`0`,style:{width:1,height:`1rem`,opacity:0,alignSelf:`center`,fontSize:`1rem`}}),(0,s.jsx)(f,{style:{opacity:0},children:m})]})},u=({selectedAsset:e,onEditSourceAsset:n})=>{let{icon:r}=t[e];return(0,s.jsxs)(p,{onClick:n,children:[(0,s.jsx)(m,{children:r}),(0,s.jsx)(h,{children:e.toLocaleUpperCase()}),(0,s.jsx)(g,{children:(0,s.jsx)(a,{})})]})},d=i.span`
  background-color: var(--privy-color-background);
  width: 100%;
  text-align: center;
  border: none;
  font-kerning: none;
  font-feature-settings: 'calt' off;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  cursor: pointer;

  &:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
  }

  && {
    color: var(--privy-color-foreground);
    font-size: 3.75rem;
    font-style: normal;
    font-weight: 600;
    line-height: 5.375rem;
  }
`,f=i.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;
  font-size: 1rem;
  font-style: normal;
  font-weight: 600;
  line-height: 1.5rem;
  margin-top: 0.75rem;
`,p=i.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: auto;
  gap: 0.5rem;
  border: 1px solid var(--privy-color-border-default);
  border-radius: var(--privy-border-radius-full);

  && {
    margin: auto;
    padding: 0.5rem 1rem;
  }
`,m=i.div`
  svg {
    width: 1rem;
    height: 1rem;
    border-radius: var(--privy-border-radius-full);
    overflow: hidden;
    border: solid 0.1px var(--privy-color-border-default);
  }
`,h=i.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;
  font-size: 0.875rem;
  font-style: normal;
  font-weight: 500;
  line-height: 1.375rem;
`,g=i.div`
  color: var(--privy-color-foreground);

  svg {
    width: 1.25rem;
    height: 1.25rem;
  }
`,_=({opts:e,isLoading:n,onSelectSource:r})=>(0,s.jsx)(o,{showClose:!1,showBack:!0,onBack:()=>r(e.source.selectedAsset),title:`Select currency`,children:(0,s.jsx)(v,{children:e.source.assets.map((e=>{let{icon:i,name:a}=t[e];return(0,s.jsx)(y,{onClick:()=>r(e),disabled:n,children:(0,s.jsxs)(b,{children:[(0,s.jsx)(x,{children:i}),(0,s.jsxs)(S,{children:[(0,s.jsx)(C,{children:a}),(0,s.jsx)(w,{children:e.toLocaleUpperCase()})]})]})},e)}))})}),v=i.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-height: 20.875rem;
  overflow-y: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`,y=i.button`
  border-color: var(--privy-color-border-default);
  border-width: 1px;
  border-radius: var(--privy-border-radius-mdlg);
  border-style: solid;
  display: flex;

  && {
    padding: 0.75rem 1rem;
  }
`,b=i.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
`,x=i.div`
  svg {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--privy-border-radius-full);
    overflow: hidden;
    border: solid 0.1px var(--privy-color-border-default);
  }
`,S=i.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
`,C=i.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25rem;
`,w=i.span`
  color: var(--privy-color-foreground-3);
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.125rem;
`;export{u as n,_ as r,l as t};