/* Map app card ids (4×15, 1=Jester/15=Wizard per suit) ↔ neural-bot training ids (4×13 + 52–55 wizards + 56–59 jesters) */
(function (global) {
  const APP_PER_SUIT = 15;
  const BOT_PER_SUIT = 13;
  const BOT_WIZARD_LO = 52;
  const BOT_JESTER_LO = 56;
  const DECK_SIZE = 60;

  function appCardIdToBotId(appId) {
    if (appId == null || appId < 0 || appId >= DECK_SIZE) return appId;
    const suit = Math.floor(appId / APP_PER_SUIT);
    const value = (appId % APP_PER_SUIT) + 1;
    if (value === 1) return BOT_JESTER_LO + suit;
    if (value === 15) return BOT_WIZARD_LO + suit;
    return suit * BOT_PER_SUIT + (value - 2);
  }

  function botCardIdToAppId(botId) {
    if (botId == null || botId < 0 || botId >= DECK_SIZE) return botId;
    if (botId >= BOT_JESTER_LO) {
      return (botId - BOT_JESTER_LO) * APP_PER_SUIT;
    }
    if (botId >= BOT_WIZARD_LO) {
      return (botId - BOT_WIZARD_LO) * APP_PER_SUIT + 14;
    }
    const suit = Math.floor(botId / BOT_PER_SUIT);
    const oldValue = (botId % BOT_PER_SUIT) + 1;
    return suit * APP_PER_SUIT + oldValue;
  }

  function mapAppIds(ids) {
    return (ids || []).map(appCardIdToBotId);
  }

  global.BotIdMap = {
    appCardIdToBotId,
    botCardIdToAppId,
    mapAppIds
  };
})(typeof window !== 'undefined' ? window : global);
