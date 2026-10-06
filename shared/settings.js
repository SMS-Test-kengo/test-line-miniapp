/**
 * イベント・特典などの設定
 *
 * - デモモードではこのファイルがそのまま使われます。
 * - 本番では Google Apps Script に「settings.gs」として同じ内容を貼り付け、そちらを編集してください。
 *   （ラリーの code は QR コードの合言葉なので、本番用の値は GAS 側にだけ書き、公開サイトには置かないでください）
 */
var APP_SETTINGS = {
  appName: 'ファンクラブ ミニアプリ',

  // デジタル会員証 / スタンプカード
  stampCard: {
    goal: 10,                         // 何個で特典1回分か
    rewardName: 'オリジナルグッズ引換券',
    rewardNote: 'スタッフに会員証を提示すると特典を使えます'
  },

  // スタンプラリー（code は QR コードに埋め込む合言葉。推測されにくい文字列に変更してください）
  rally: {
    title: 'スタンプラリー',
    rewardName: '限定ステッカー',
    checkpoints: [
      { id: 'cp1', name: 'エントランス', hint: '入口の大きな看板の横', code: 'RALLY-cp1-8kQ2vXa7' },
      { id: 'cp2', name: '物販ブース', hint: 'グッズ売り場のレジ前', code: 'RALLY-cp2-Lm4pZ9tw' },
      { id: 'cp3', name: 'フォトスポット', hint: 'パネル展示のエリア', code: 'RALLY-cp3-Qe7rN2bc' },
      { id: 'cp4', name: 'カフェ', hint: 'コラボカフェのカウンター', code: 'RALLY-cp4-Hs5yT8jd' }
    ]
  },

  // アンケート / 投票（showResults: true にすると回答後に集計結果を表示する「投票」になります）
  // type: single=1つ選択 / multi=複数選択 / text=自由記述
  surveys: [
    {
      id: 'vote1',
      title: '次のライブで聴きたい曲は？',
      description: '1人1票です。投票後に途中結果を見られます。',
      showResults: true,
      questions: [
        { id: 'q1', type: 'single', label: '1曲選んでください', required: true,
          options: ['曲A', '曲B', '曲C', '曲D'] }
      ]
    },
    {
      id: 'survey1',
      title: '来場者アンケート',
      description: '今後のイベント改善のためご協力ください。',
      showResults: false,
      questions: [
        { id: 'age', type: 'single', label: '年代', required: true,
          options: ['10代', '20代', '30代', '40代', '50代以上'] },
        { id: 'source', type: 'multi', label: 'イベントを知ったきっかけ', required: false,
          options: ['LINE', 'X（旧Twitter）', 'Instagram', '公式サイト', '友人・知人'] },
        { id: 'comment', type: 'text', label: 'ご意見・ご感想', required: false }
      ]
    }
  ],

  // イベント受付（整理券・呼び出し）。番号は日付ごとに 1 番から振り直されます
  ticket: {
    title: '受付整理券',
    open: true,                       // false にすると新規発行を停止
    callMessage: '整理券番号 {no} 番のお客様、お待たせしました。受付までお越しください。'
  },

  // 予約（1人1件まで）
  reservation: {
    title: '来場予約',
    maxPeople: 4,
    slots: [
      { id: 's1', label: '10/12(日) 11:00〜', capacity: 20 },
      { id: 's2', label: '10/12(日) 13:00〜', capacity: 20 },
      { id: 's3', label: '10/12(日) 15:00〜', capacity: 20 }
    ]
  },

  // 外部ID連携（スプレッドシートの ext_master シートと照合します）
  extLink: {
    title: '会員ID連携',
    description: 'お持ちの会員番号とLINEを連携すると、会員特典をLINEで受け取れます。',
    idLabel: '会員番号',
    keyLabel: '生年月日（8桁 例: 19900101）'
  }
};
