// epub.js 没有自带类型声明，v0 先用宽松声明，避免为了类型去维护一份 d.ts。
declare module 'epubjs' {
  const ePub: any;
  export default ePub;
}
