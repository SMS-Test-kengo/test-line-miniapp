/**
 * 接続設定
 *
 * LIFF_ID が空のあいだは「デモモード」で動きます（LINEログインなし・データはこの端末内に保存）。
 * 本番では LINE Developers で発行された LIFF ID と、GAS のウェブアプリ URL を入れてください。
 */
window.APP_CONFIG = {
  LIFF_ID: '2011900624-jT8NGkeZ',   // 例: '2001234567-AbCdEfGh'
  API_URL: 'https://script.google.com/macros/s/AKfycbxqmsPz_fw8G2OzCa-_uxspaZhQ1IMM7AlhUi-lMIi6dgr2iCjiTlDY2mYWVgz4inek/exec'    // 例: 'https://script.google.com/macros/s/xxxxxxxx/exec'
};
