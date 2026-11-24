export type Locale = 'zh-CN' | 'en';

const zhCN = {
  'brand.subtitle': '撸猫馆',

  'nav.mainLabel': '主导航',
  'nav.lobby': '大厅',
  'nav.honor': '荣誉墙',
  'nav.guestCard': '入馆卡',
  'nav.staffRoom': '员工室',
  'nav.browseLobby': '逛逛大厅',
  'nav.sendCatToWork': '送你家猫来上班',

  'cat.backToLobby': '回大厅',
  'cat.moreActions': '更多：举报、隐藏这只猫',
  'cat.mobileStatus': 'JP 东京 · 在岗',
  'cat.webStatusBeforeTime': '{name} 在岗 · 东京下午 ',
  'cat.webStatusTime': '3',
  'cat.webStatusAfterTime': ' 点',
  'cat.officialBadge': '正式馆猫',
  'cat.badgeLocation': 'JP · 东京',
  'cat.badgeDaysBefore': '上班 ',
  'cat.badgeDaysAfter': ' 天',
  'cat.badgeGuestsAfter': ' 位客人',
  'cat.tagClingy': '粘人',
  'cat.tagFoodie': '贪吃',
  'cat.shareCat': '分享 {name}',
  'cat.reportHide': '举报 · 隐藏这只猫',
  'cat.avatarAlt': '{name} 的头像',
  'cat.stageSectionLabel': '撸 {name}',
  'cat.defaultName': '猫猫',

  'pet.loading': '{name} 刚醒，稍等一下',
  'pet.loadingAria': '正在准备撸猫舞台',
  'pet.stageAria':
    '互动撸猫舞台。用鼠标或手指轻抚，或聚焦后使用方向键移动手来撸猫。',
  'pet.fallbackAlt': '{name} 蜷在毯子上',
  'pet.fallbackAltGeneric': '毯子上的猫',
  'pet.fallbackMessage': '当前浏览器暂不支持互动撸猫，但 {name} 依然喜欢你。',
  'pet.mute': '静音',
  'pet.unmute': '取消静音',
  'pet.muteTitle': '静音 (M)',
  'pet.unmuteTitle': '取消静音 (M)',
  'pet.meterAria': '呼噜进度',
  'pet.moodIdle': '摸摸它',
  'pet.moodPetting': '舒服起来了…',
  'pet.moodPurring': '呼噜中',
  'pet.moodMelt': '融化啦',
  'pet.moodNip': '轻一点，{name} 有点小脆弱',

  'page.lobby.eyebrow': '大厅',
  'page.lobby.title': '今天在岗的猫',
  'page.lobby.body': '实时撸猫大厅和今日店长猫将在这里上线。',
  'page.onboard.eyebrow': '前台',
  'page.onboard.title': '欢迎新同事',
  'page.onboard.body':
    '上传照片、点一下抠出猫咪、领一张工牌，送你家猫来上班。',
  'page.staffRoom.eyebrow': '员工室',
  'page.staffRoom.title': '你的猫与工资条',
  'page.staffRoom.body':
    '每周工资条、被撸人数和来自世界各地的客人统计将在这里查看。',
  'page.about.eyebrow': '关于',
  'page.about.title': '关于 purr.si 撸猫馆',
  'page.about.body': '送你家猫来上班，分享一条链接，让全世界撸你的猫。',
  'page.privacy.eyebrow': '隐私',
  'page.privacy.title': '隐私说明',
  'page.privacy.body': '隐私条款与数据处理说明将发布在这里。',
  'page.terms.eyebrow': '条款',
  'page.terms.title': '使用条款',
  'page.terms.body': '使用规则与举报指引将发布在这里。',
  'page.notFound.title': '没找到这间猫房',
  'page.notFound.body': '这个地址暂时没有猫蜷在这里睡觉。',
  'page.notFound.backHome': '回大厅',
} as const;

export type MessageKey = keyof typeof zhCN;

const en: Record<MessageKey, string> = {
  'brand.subtitle': 'cat café',

  'nav.mainLabel': 'Main navigation',
  'nav.lobby': 'Lobby',
  'nav.honor': 'Hall of Fame',
  'nav.guestCard': 'Guest Card',
  'nav.staffRoom': 'Staff Room',
  'nav.browseLobby': 'Browse lobby',
  'nav.sendCatToWork': 'Bring your cat to work',

  'cat.backToLobby': 'Back to lobby',
  'cat.moreActions': 'More: report or hide this cat',
  'cat.mobileStatus': 'JP Tokyo · On duty',
  'cat.webStatusBeforeTime': '{name} on duty · Tokyo ',
  'cat.webStatusTime': '3',
  'cat.webStatusAfterTime': ' PM',
  'cat.officialBadge': 'Official cat',
  'cat.badgeLocation': 'JP · Tokyo',
  'cat.badgeDaysBefore': '',
  'cat.badgeDaysAfter': ' days on duty',
  'cat.badgeGuestsAfter': ' guests',
  'cat.tagClingy': 'Clingy',
  'cat.tagFoodie': 'Foodie',
  'cat.shareCat': 'Share {name}',
  'cat.reportHide': 'Report · Hide this cat',
  'cat.avatarAlt': "{name}'s avatar",
  'cat.stageSectionLabel': 'Pet {name}',
  'cat.defaultName': 'the cat',

  'pet.loading': '{name} just woke up, one moment',
  'pet.loadingAria': 'Loading cat petting stage',
  'pet.stageAria':
    'Interactive cat petting stage. Stroke with mouse or finger, or focus and use arrow keys to move the hand and pet.',
  'pet.fallbackAlt': '{name} curled up on a blanket',
  'pet.fallbackAltGeneric': 'Cat on a blanket',
  'pet.fallbackMessage':
    "Your browser can't show petting here, but {name} still loves you.",
  'pet.mute': 'Mute purr sound',
  'pet.unmute': 'Unmute purr sound',
  'pet.muteTitle': 'Mute purr (M)',
  'pet.unmuteTitle': 'Unmute purr (M)',
  'pet.meterAria': 'Purr meter',
  'pet.moodIdle': 'Stroke to pet',
  'pet.moodPetting': 'Warming up…',
  'pet.moodPurring': 'Purring',
  'pet.moodMelt': 'Pure bliss',
  'pet.moodNip': 'Gentle, {name} is a bit sensitive',

  'page.lobby.eyebrow': 'Lobby',
  'page.lobby.title': 'Cats on duty today',
  'page.lobby.body':
    'The live cat lobby and Cat of the Day will appear here.',
  'page.onboard.eyebrow': 'Front desk',
  'page.onboard.title': 'Welcome, new colleague',
  'page.onboard.body':
    'Upload a photo, tap to cut out your cat, and claim a badge to bring your cat to work.',
  'page.staffRoom.eyebrow': 'Staff room',
  'page.staffRoom.title': 'Your cats & payslips',
  'page.staffRoom.body':
    'Weekly payslips, pet counts, and visitor countries will appear here.',
  'page.about.eyebrow': 'About',
  'page.about.title': 'About purr.si',
  'page.about.body':
    'Bring your cat to work, share a link, and let the whole world pet them.',
  'page.privacy.eyebrow': 'Privacy',
  'page.privacy.title': 'Privacy policy',
  'page.privacy.body':
    'Privacy details and data handling information will be published here.',
  'page.terms.eyebrow': 'Terms',
  'page.terms.title': 'Terms of service',
  'page.terms.body':
    'Terms of use and reporting guidelines will be published here.',
  'page.notFound.title': 'Room not found',
  'page.notFound.body': 'There is no cat curled up at this address.',
  'page.notFound.backHome': 'Back to lobby',
};

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
};

export function getLocale(): Locale {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.language === 'string' &&
    navigator.language.toLowerCase().startsWith('zh')
  ) {
    return 'zh-CN';
  }
  return 'en';
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let text: string = DICTIONARIES[getLocale()][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
