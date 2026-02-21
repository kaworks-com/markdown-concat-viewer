/**
 * esbuild-sass-plugin（type: 'css-text'）によって処理された .scss ファイルを
 * CSS 文字列として import できるようにするための型宣言
 */
declare module '*.scss' {
    const css: string;
    export default css;
}
