/* Super Smash Ballers — what's coming. Ids are wiki slugs; when a fighter or stage with the same id is registered,
   it drops off this list automatically (S.roadmap()), and should then be deleted from here in the same update. */
(function () {
  "use strict";
  const S = window.Smash;
  S.ROADMAP = {
    fighters: [
      { id: "lightning-mcqueen", name: "Lightning McQueen", note: "Toyota Corolla. Chick-fil-A loyalist. Glock 19." },
      { id: "chatgpt", name: "ChatGPT", note: "Gasps in XML. Speaker mecha wings." },
      { id: "dj-khaled", name: "DJ Khaled", note: "Summons lobsters. Another one." },
      { id: "ron-desantis", name: "Ron DeSantis", note: "Stabber of Chris." },
      { id: "elon-musk", name: "Elon Musk", note: "Conqueror of two universes, half of Samwise." },
      { id: "frodo", name: "Frodo Baggins", note: "Conqueror of Andromeda. Ate the universe." },
      { id: "kanye-west", name: "Kanye West", note: "Ye the Gas. Prius of Destiny." },
      { id: "mf-vroom", name: "MF Vroom", note: "A car wearing a robe." },
      { id: "spamton", name: "Spamton G. Spamton", note: "[Recipe enthusiast]." },
      { id: "drake-batman", name: "Drake Batman", note: "The Dark Knight, in Uggs. Axe body spray smoke." },
      { id: "walter-white", name: "Walter White", note: "Dreamer of Erger Wings." },
      { id: "microsoft-bing", name: "Microsoft Bing", note: "Search engine. Robot. Casino guardian." },
    ],
    stages: [
      { id: "galactic-senate", name: "The Galactic Senate", note: "Formerly staffed by 80-year-olds." },
      { id: "gotham-city", name: "Gotham City", note: "98.7% darkness." },
      { id: "club-shadowban", name: "Club Shadowban", note: "Nightly Joker residency." },
      { id: "newark", name: "Newark", note: "Birthplace of Chris." },
      { id: "andromeda-galaxy", name: "Andromeda Galaxy", note: "Taken by Frodo." },
      { id: "dunder-mifflin", name: "Dunder Mifflin (Galaxy)", note: "A galaxy. In an office building." },
      { id: "abandoned-walmarts", name: "The Abandoned Walmarts", note: "Nadir-side real estate." },
      { id: "xbox-live-dungeons", name: "The Xbox Live Dungeons", note: "Barbaric. Horrific. Endless." },
    ],
  };
  // The list minus anything already in the game.
  S.roadmap = function () {
    const R = S.ROADMAP;
    return { fighters: R.fighters.filter((x) => !S.FIGHTERS[x.id]), stages: R.stages.filter((x) => !S.STAGES[x.id]) };
  };
})();
