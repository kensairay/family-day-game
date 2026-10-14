// Server-only sample bank. Change questions here before rehearsal, not mid-game.
export const POINTS = 260;
export const ROUNDS = [
  {name:'第一回合 · 暖身題', questions:[
    {text:'一年有幾個月？', options:['10 個','11 個','12 個','13 個'], correct:2},
    {text:'紅燈亮起時，行人應該怎麼做？', options:['直接通過','停下等待','閉眼前進','跟著車走'], correct:1},
    {text:'哪一種動物是哺乳類？', options:['蝴蝶','金魚','青蛙','海豚'], correct:3}
  ]},
  {name:'第二回合 · 生活小知識', questions:[
    {text:'吃飯前，哪個動作有助保持衛生？', options:['洗手','摸鞋底','玩泥巴','揉眼睛'], correct:0},
    {text:'一星期有幾天？', options:['5 天','6 天','7 天','8 天'], correct:2},
    {text:'哪個物品可以重複使用，減少一次性垃圾？', options:['用完即丟的紙杯','自己的水壺','一次性吸管','一次性塑膠袋'], correct:1}
  ]},
  {name:'第三回合 · 最後挑戰', questions:[
    {text:'三角形有幾條邊？', options:['2 條','3 條','4 條','5 條'], correct:1},
    {text:'彩虹常被描述為幾種顏色？', options:['3 種','5 種','7 種','9 種'], correct:2},
    {text:'哪一個是地球的天然衛星？', options:['太陽','火星','金星','月球'], correct:3}
  ]}
];
export const QUESTIONS = ROUNDS.flatMap((round, r) => round.questions.map((q, i) => ({
  ...q, id:`r${r+1}q${i+1}`, round:r+1, number:i+1, roundName:round.name
})));
