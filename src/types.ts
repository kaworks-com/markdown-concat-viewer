/**
 * TOC（目次）の各見出し項目を表す型
 */
export type TocItem = {
    fileIndex: number;
    fileName: string;
    fileUriKey: string;
    level: number; // 1..6
    text: string;
    anchorId: string;
    sourceLine: number;
};

/**
 * TOC のファイルグループを表す型
 */
export type TocFile = {
    fileIndex: number;
    fileName: string;
    fileUriKey: string;
};
