import{q as H,f as E,t as w,w as B,x as R,y as N,v as C,j as q,z,A,m as O,B as D}from"./DocumentWorkspace-Aazm3t13.js";import{C as d}from"./DocumentWorkspace-Aazm3t13.js";import"./index-DNSwijQc.js";import"./draft-xml-runtime-CFkymArP.js";import"./WorkspaceChrome-CELr_ijS.js";import"./draft-math-runtime-C7umrvKo.js";import"./draft-paste-sanitizer-DowdsyMd.js";const S=a=>a.replace(/([\\`*_[\]<>~|])/g,"\\$1"),F=a=>"<"+a.replace(/[<>\\]/g,i=>"%"+i.charCodeAt(0).toString(16).toUpperCase())+">";function v(a,i){const[,e,r,f]=/^(\s*)([\s\S]*?)(\s*)$/.exec(a);return r?e+i+r+i+f:a}function G(a){const i=Math.max(0,...(a.match(/`+/g)||[]).map(f=>f.length))+1,e="`".repeat(i),r=/(^`|`$|^ .* $)/.test(a)?" ":"";return e+r+a.replace(/\n/g," ")+r+e}function K(a){const i=H(a),e=new Set;function r(t){var m,l,x;(m=t.attrs)!=null&&m.targetId&&e.add(String(t.attrs.targetId));for(const b of t.marks||[])b.type==="link"&&String((l=b.attrs)==null?void 0:l.href).startsWith("#")&&e.add(String(b.attrs.href).slice(1));(x=t.content)==null||x.forEach(r)}r(i.document);const f=t=>C(t)?`<a id="${A(t)}"></a>`:"";function g(t,m={}){var l,x,b,s,p,n,o,k,u,$,j,I,M;if(t.type==="captionNumber")return S(w(t));if(t.type==="text"){const y=i.run(t,m);let h=(l=t.marks)!=null&&l.some(L=>L.type==="code")?G(t.text||""):S(t.text||"");y.bold&&(h=v(h,"**")),y.italic&&(h=v(h,"*")),(x=t.marks)!=null&&x.some(L=>L.type==="strike")&&(h=v(h,"~~"));const T=q((p=(s=(b=t.marks)==null?void 0:b.find(L=>L.type==="link"))==null?void 0:s.attrs)==null?void 0:p.href);return T?`[${h}](${F(T)})`:h}if(t.type==="hardBreak")return`  
`;if(t.type==="pageBreak")return`

`;if(t.type==="image"){const y=z(String(((n=t.attrs)==null?void 0:n.src)||""));return y?`![${S(String(((o=t.attrs)==null?void 0:o.alt)||""))}](${F(y)})`:S(String(((k=t.attrs)==null?void 0:k.alt)||"[Image]"))}return t.type==="crossReference"?C((u=t.attrs)==null?void 0:u.targetId)?`[${S(String((($=t.attrs)==null?void 0:$.label)||""))}](#${t.attrs.targetId})`:S(String(((j=t.attrs)==null?void 0:j.label)||"")):t.type==="noteReference"?`[^${(I=t.attrs)==null?void 0:I.id}]`:(t.type==="bookmark"?f((M=t.attrs)==null?void 0:M.id):"")+(t.content||[]).map(y=>g(y,m)).join("")}function c(t){var l,x,b;const m=()=>(t.content||[]).map(c).join(`

`);if(t.type==="doc"||t.type==="listItem")return m();if(t.type==="paragraph"||t.type==="heading"||t.type==="codeBlock"){const s=i.level(t);if(E(t)==="Code"||t.type==="codeBlock"){const o=w(t),k="`".repeat(Math.max(3,Math.max(0,...(o.match(/`+/g)||[]).map(u=>u.length))+1));return`${k}
${o}
${k}`}const p=i.format(t);s&&(p.bold=!1);let n=(t.content||[]).map(o=>g(o,p)).join("");return s||(n=n.replace(/^( {0,3})([-+#>]|\d+[.)])(?=\s)/gm,"$1\\$2")),s&&(n="#".repeat(s)+" "+n),E(t)==="Quote"&&(n=n.split(`
`).map(o=>"> "+o).join(`
`)),(e.has(String((l=t.attrs)==null?void 0:l.anchorId))?f((x=t.attrs)==null?void 0:x.anchorId)+`

`:"")+n}if(t.type==="bulletList"||t.type==="orderedList")return(t.content||[]).map((s,p)=>{var o;const n=t.type==="bulletList"?"- ":`${Math.round(B((o=t.attrs)==null?void 0:o.start,1,1,999999))+p}. `;return n+c(s).replace(/\n/g,`
`+" ".repeat(n.length))}).join(`
`);if(t.type==="table"){if((t.content||[]).some(u=>{var $;return($=u.content)==null?void 0:$.some(j=>{var I,M,y;return Number(((I=j.attrs)==null?void 0:I.colspan)||1)>1||Number(((M=j.attrs)==null?void 0:M.rowspan)||1)>1||((y=j.content)==null?void 0:y.some(h=>!["paragraph","heading"].includes(h.type)))})}))return R({type:"doc",content:[t]});const p=N(t);if(!p.length||!p[0].length)return"";const n=p[0].every(u=>(u==null?void 0:u.type)==="tableHeader"),o=u=>"| "+u.map($=>(($==null?void 0:$.content)||[]).map(j=>(j.content||[]).map(I=>g(I)).join("")).join("<br>").replace(/\n/g,"<br>")).join(" | ")+" |",k=n?p.shift():p[0].map(()=>null);return[o(k),"| "+k.map(()=>"---").join(" | ")+" |",...p.map(o)].join(`
`)}return t.type==="tableOfContents"?(t.content||[]).map(s=>{var p,n;return"  ".repeat(B((p=s.attrs)==null?void 0:p.level,1,1,6)-1)+`- [${S(w(s))}](#${C((n=s.attrs)==null?void 0:n.targetId)?s.attrs.targetId:""})`}).join(`
`):t.type==="note"?`[^${(b=t.attrs)==null?void 0:b.id}]: `+m().replace(/\n/g,`
    `):t.type==="blockquote"?m().split(`
`).map(s=>"> "+s).join(`
`):t.type==="horizontalRule"?"---":g(t)}return c(i.document).replace(/\n[ \t]+\n/g,`

`).trimEnd()+`
`}function V(a){const{document:i}=H(a);function e(r){var f,g;return r.type==="doc"||r.type==="listItem"?(r.content||[]).map(e).join(`

`):r.type==="bulletList"||r.type==="orderedList"?(r.content||[]).map((c,t)=>{var l;const m=r.type==="bulletList"?"- ":`${Math.round(B((l=r.attrs)==null?void 0:l.start,1,1,999999))+t}. `;return m+e(c).replace(/\n/g,`
`+" ".repeat(m.length))}).join(`
`):r.type==="table"?N(r).map(c=>c.map(t=>t?e({type:"doc",content:t.content}).replace(/\n+/g," "):"").join("	")).join(`
`):r.type==="tableOfContents"?(r.content||[]).map(c=>{var t;return"  ".repeat(Math.max(0,Number((t=c.attrs)==null?void 0:t.level)-1))+w(c)}).join(`
`):r.type==="note"?`${((f=r.attrs)==null?void 0:f.kind)==="endnote"?"Endnote":"Footnote"} ${(g=r.attrs)==null?void 0:g.number}: ${(r.content||[]).map(e).join(`

`)}`:r.type==="horizontalRule"?"---":r.type==="blockquote"?(r.content||[]).map(e).join(`

`):w(r)}return e(i).replace(/\n{3,}/g,`

`).trimEnd()+`
`}function X(a,i){var e;for(const r of O(a))for(const f of[400,700])for(const g of["normal","italic"])for(const c of["latin","latin-ext"])if(!((e=i.fonts)!=null&&e.some(t=>t.family===r&&t.weight===f&&t.style===g&&t.subset===c)))throw new Error(`Missing embedded font: ${r} ${f} ${g} ${c}`);return D(a,i)}export{d as exportFileName,D as exportHTML,K as exportMarkdown,X as exportPDF,V as exportText};
