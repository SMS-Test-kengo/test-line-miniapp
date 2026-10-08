/**
 * 接続設定
 *
 * LIFF_ID が空のあいだは「デモモード」で動きます（LINEログインなし・データはこの端末内に保存）。
 * 本番では LINE Developers で発行された LIFF ID と、GAS のウェブアプリ URL を入れてください。
 */
window.APP_CONFIG = {
  LIFF_ID: '2011900624-jT8NGkeZ',   // 例: '2001234567-AbCdEfGh'
  API_URL: 'https://hdxai43ioeltpkbddzujgbomea0fypoi.lambda-url.ap-northeast-1.on.aws/',   // AWS Lambda 関数URL（東京）
  OA_BASIC_ID: '@259wvlrv'   // 呼び出し通知を送る LINE 公式アカウントのベーシックID（例: '@123abcde'）。空なら友だち追加の案内は出ない
};
