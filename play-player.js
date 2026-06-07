// ─── Player generation ────────────────────────────────────────────────────
// Sprawling, multi-cultural name pool. American + biblical + international
// (German, Italian, Polish, Hispanic, Japanese, Korean, Polynesian/Samoan).
// Spelling variants (Brendan/Brenden, Müller/Mueller, Jürgen/Juergen) are
// included so two players can share a phonetic name but read distinctly.
// Creative D'/Ja'/La' names get generated on the fly to add freshness.
// pickLastName() rolls a chance for a hyphenated double-barrel last name.
const FIRST = [
  // Modern American — common (heavily expanded so pop-culture names dilute
  // into the background)
  "Marcus","Markus","Marqus","Tyler","Tylar","Darius","Dareius","Daryus","Jordan","Jordon",
  "Malik","Mahleek","Malek","Devon","Devyn","Devontae","Xavier","Cameron","Kameron","Jaylen",
  "Jaelen","Jalen","Trevor","Trevour","Nathan","Nathen","Brandon","Branden","Brendan","Brenden",
  "Brennan","Derrick","Derek","Antonio","Anthony","Deon","Travon","Rasheed","Quincy","Zach",
  "Zack","Zackary","Hunter","Brayden","Braden","Braiden","Cole","Coll","Jake","Jaykob","Ryan",
  "Ryne","Rion","Luke","Lukas","Lucas","Evan","Aaron","Aron","Chris","Cris","Jamal","Tyrone",
  "Lamar","Lamarr","Andre","Aundre","Reggie","Reggi","Stefon","Stefan","Stephon","Amari","Cooper",
  "Travis","Cam","Justin","Jusstyn","Dak","Patrick","Patric","Kyler","Bryce","Brice","Joe",
  "Christian","Kristian","Najee","Sterling","Trenton","Trentin","Bryson","Brycen","Jaxon",
  "Jaxson","Jacksen","Kade","Drake","Maverick","Hayden","Haiden","Walker","Sawyer","Easton",
  "Tate","Beckett","Cason","Karsten","Carsten","Tanner","Kellen","Kellan","Knox","Wyatt","Wyat",
  "Greyson","Grayson","Sutton","Briggs","Boone",
  // Top common American given names — drawn from real US census data
  "Michael","James","Robert","John","William","Richard","Charles","Joseph","Donald","Steven",
  "Andrew","Kenneth","Kevin","Edward","Paul","George","Brian","Mark","Jason","Jeff","Gary",
  "Larry","Frank","Scott","Eric","Stephen","Raymond","Dennis","Jerry","Walter","Peter","Harold",
  "Douglas","Adam","Arthur","Lawrence","Albert","Roy","Eugene","Wayne","Mason","Ethan","Logan",
  "Jacob","Owen","Lincoln","Sebastian","Henry","Jack","Ben","Benjamin","Theo","Theodore",
  "Liam","Noah","Oliver","Charlie","Carter","Dylan","Alexander","Connor","Jonathan","Jeremy",
  "Greg","Russell","Bobby","Jimmy","Tommy","Joey","Mike","Steve","Dave","Rob","Ricky","Billy",
  "Sam","Sammy","Will","Willy","Nick","Nico","Tony","Frankie","Charlie","Eddie","Teddy","Vince",
  "Vinny","Sal","Sully","Buddy","Hank","Pete","Don","Donny","Lenny","Manny","Marty","Mickey",
  "Tommy","Wally","Jimmy","Bobby","Jake","Toby","Rusty","Vinnie","Curt","Kurt","Marv","Murph",
  "Brendon","Reid","Quinn","Riley","Garrett","Brett","Brock","Chase","Trent","Trey","Trae","Drew",
  "Blake","Brady","Cody","Casey","Colby","Colton","Dawson","Derek","Dustin","Garrison","Graham",
  "Holden","Hayes","Jett","Kane","Keaton","Korbin","Landon","Levi","Lyle","Mac","Mack","Miles",
  "Nolan","Nash","Pierce","Reece","Rhett","Rocco","Rocky","Sully","Tucker","Wesley","Wes",
  "Zane","Zeke","Cory","Cory","Brent","Buddy","Chuck","Curt","Dale","Dean","Dirk","Doug","Ernie",
  "Floyd","Glenn","Hal","Herb","Ira","Jerry","Karl","Lance","Leon","Lou","Marvin","Max","Milt",
  "Monte","Otis","Ralph","Sid","Stan","Vern","Wendell","Woody","Wyatt","Vance","Tucker",
  // Modern Black American / rapper-inspired first-name patterns. These follow
  // the linguistic style without being literal stage names — DeAndre, Marquise,
  // Davion, etc. are common NFL first names.
  "DeAndre","DeAndré","DeOndre","DeShawn","DeSean","DeMarcus","DeMario","DeVonte","DeVantae",
  "Demarius","Damari","Damarion","Damarcus","Devonte","Davion","Davaughn","Davonte","Daquan",
  "Daquarius","DaQuan","Darnell","Devontay","Deontay","Deontae","Donte","Donté","Donovan",
  "Donny","Donyell","Darnel","Darreon","Darian","Dareion","Darrius","Markeese","Marquise",
  "Marqueese","Marquez","Marquice","Marquell","Marshawn","Tarvarius","Tarvarus","Tre","Trey",
  "Trae","Trayvon","Treyvon","Trayveon","Tyriq","Tyrique","Tyron","Tariq","Quavion","Quavari",
  "Quavante","Quavan","Quincy","Quinten","Quinton","Quenton","Quinten","Quentavius","Quay",
  "Quan","Quez","Vez","Zay","Zaire","Zayn","Zayde","Cuse","Cee","Dre","Drey","Quavo","Cordae",
  "Polo","Roddy","Latto","Jeezy","Saweetie","Trippie","Lupe","Cyhi","Maino","Pusha","Plies",
  "Boosie","NLE","Nelly","Future","Tory","Wale","Yachty","Trinidad","Migos","Stat","Slim",
  "Mookie","Boogie","Hustle","Black","Tobe","Tee","Vee","Bee","Ace","Brey","Quay","Quan",
  // Acronym-style initials (J.J. Watt, T.J. Watt, A.J. Brown, C.J. Stroud)
  "J.J.","T.J.","A.J.","D.J.","R.J.","C.J.","M.J.","B.J.","L.J.","K.J.","O.J.","E.J.",
  "P.J.","N.J.","K.D.","O.D.","D'J.","T.J.","Y.K.","X.K.",
  // Biblical (subtle, most read as normal American)
  "Daniel","Danyel","David","Davyd","Joshua","Joshuah","Samuel","Samual","Eli","Ezra","Esra",
  "Josiah","Josyah","Micah","Mykah","Asher","Levi","Caleb","Kaleb","Kayleb","Isaiah","Izaiah",
  "Elijah","Elija","Gideon","Boaz","Silas","Sylas","Ezekiel","Jonah","Jonas","Jeremiah",
  // Japanese
  "Hiroshi","Kenji","Daichi","Haruto","Yuki","Sho","Takuya","Ryo","Akira","Kazuki",
  "Riku","Yuta","Sota","Kaito","Renji","Tatsuya","Hayato","Souta","Tsubasa","Daiki",
  // Korean
  "Min-jun","Hyun","Jin","Sung","Joon","Tae","Dong","Seung","Jisoo","Beom",
  // Polynesian (Samoan/Tongan/Maori)
  "Tua","Penei","Tuli","Mosi","Lavaka","Vita","Aolelei","Sefo","Manu","Tevita","Sione","Lopeti",
  // German / Austrian (with umlaut/non-umlaut variants)
  "Lukas","Maximilian","Stefan","Otto","Rolf","Wolfgang","Jürgen","Juergen","Hartmut","Sebastian",
  "Klaus","Niklas","Bastian","Florian","Kai","Anders","Björn","Bjoern","Günther","Guenther",
  // Italian (with diacritic variants)
  "Marco","Luca","Matteo","Alessandro","Lorenzo","Gianluca","Giovanni","Dante","Niccolò","Niccolo",
  // Hispanic / Latin (with diacritics)
  "Diego","Mateo","Santiago","Carlos","Javier","Andrés","Andres","Rafa","Emilio","Joaquín",
  "Joaquin","Cristián","Cristian","Adrián","Adrian","Iván","Ivan","René","Rene",
  // Scandinavian / Slavic
  "Anders","Magnus","Henrik","Bjorn","Olek","Tadek","Kacper","Filip","Janek","Mikkel","Søren","Soren",
  // West African
  "Kwame","Kofi","Sefu","Bayo","Adisa","Femi","Tunde","Kenan",
  // Brazilian / Portuguese
  "Caio","Thiago","Rodrigo","Vinicius","João","Joao","Murilo","Vinícius",
  // Hyphenated double firsts (sprinkle)
  "Jean-Paul","Jean-Luc","Pierre-Marc","Hans-Peter","Karl-Heinz","Juan-Carlos","Marco-Antonio",
  // Russian / Slavic
  "Dmitri","Boris","Nikolai","Igor","Sergei","Pavel","Mikhail","Yuri","Viktor","Alexei",
  // Middle Eastern / Arabic
  "Tariq","Khalid","Omar","Ahmed","Yusuf","Hassan","Karim","Faisal","Bilal","Rashid",
  // Indian / Sanskrit
  "Arjun","Krishna","Rajiv","Vikram","Sanjay","Aditya","Raj","Dev","Kabir","Rohan",
  // Hawaiian / Pacific
  "Kainoa","Makoa","Keoni","Kalani","Akoni","Kona","Nainoa",
  // Native American (modern usage)
  "Cheyenne","Dakota","Sequoia",
  // Greek mythology
  "Atlas","Achilles","Hector","Ajax","Apollo","Ares","Theseus","Perseus","Heracles","Odysseus",
  "Cassius","Brutus","Leonidas","Orion","Castor","Polydeuces","Aeneas",
  // Norse mythology
  "Thor","Odin","Loki","Tyr","Bragi","Freyr","Baldur","Magnus","Ragnar",
  // Game of Thrones
  "Jon","Robb","Bran","Ned","Eddard","Sandor","Jaime","Theon","Tormund","Aemon",
  "Stannis","Renly","Petyr","Gregor","Bronn","Davos","Samwell","Podrick","Mance","Tywin",
  "Doran","Oberyn","Tyrion","Jorah",
  // Star Wars
  "Anakin","Han","Lando","Mace","Boba","Jango","Kylo","Finn","Poe","Cassian","Bodhi",
  "Galen","Saw","Cal","Ezra","Kanan",
  // Lord of the Rings
  "Aragorn","Frodo","Bilbo","Gandalf","Legolas","Gimli","Boromir","Faramir","Eomer","Theoden",
  "Elrond","Pippin","Merry","Beregond","Halbarad","Imrahil",
  // The Matrix
  "Morpheus","Neo","Cypher",
  // Dune
  "Paul","Duncan","Stilgar","Leto","Gurney","Idaho","Liet",
  // Breaking Bad / pop classics
  "Walter","Jesse","Saul","Mike","Tuco","Hank",
  // Anime (Dragon Ball, Naruto, etc.)
  "Goku","Vegeta","Trunks","Gohan","Krillin","Naruto","Itachi","Sasuke","Kakashi",
  // Marvel / DC heroes
  "Logan","Bruce","Steve","Peter","Clark","Wade","Tony","Stephen","Scott","Hal",
  // Cultural significants from other angles
  "Cyrus","Darius","Hannibal","Spartacus","Genghis","Attila","Augustus",
  // Roman names (emperors, generals, philosophers)
  "Caesar","Lucius","Maximus","Octavian","Aurelius","Cato","Tiberius","Trajan","Nero","Vespasian",
  "Hadrian","Cicero","Crassus","Pompey","Sulla","Constantine","Diocletian","Antoninus",
  // Greek (philosophers, kings, heroes — not in mythology block)
  "Alexander","Aristotle","Plato","Socrates","Pythagoras","Pericles","Themistocles","Leonidas",
  "Stavros","Petros","Yannis","Dimitris","Nikolaos","Konstantinos",
  // Egyptian (pharaohs and gods used as names)
  "Ramses","Khufu","Akhenaten","Thutmose","Senusret","Imhotep","Ptolemy","Khaemwaset","Tutankhamun",
  "Anubis","Horus","Osiris","Sobek","Khepri",
  // Celtic / Welsh / Irish
  "Cormac","Conor","Lorcan","Padraig","Niall","Eoin","Owen","Bran","Bronn","Rhys","Dafydd",
];

const LAST = [
  // Modern American — common (heavily expanded so pop-culture names dilute)
  "Johnson","Williams","Brown","Jones","Davis","Miller","Wilson","Moore","Taylor","Anderson",
  "Thomas","Jackson","White","Harris","Martin","Thompson","Robinson","Clark","Lewis","Lee",
  "Walker","Hall","Allen","Young","Hill","Green","Adams","Nelson","Baker","Carter",
  "Mitchell","Roberts","Turner","Phillips","Campbell","Reed","Brooks","Bell","Reeves","Coleman",
  "Hayes","Bryant","Ford","Knight","Banks","Stone","Vaughn","Rivers","Shaw","Lane",
  // Top common US surnames — drawn from census data
  "Wright","Hughes","Watson","Edwards","Collins","Stewart","Morris","Murphy","Cook","Cooper",
  "Richardson","Cox","Howard","Ward","Peterson","Gray","James","Kelly","Sanders","Price",
  "Bennett","Wood","Barnes","Ross","Henderson","Jenkins","Perry","Powell","Long","Patterson",
  "Washington","Butler","Simmons","Foster","Gonzales","Alexander","Russell","Griffin","Hamilton",
  "Graham","Sullivan","Wallace","Woods","Cole","West","Owens","Reynolds","Fisher","Ellis",
  "Harrison","Gibson","Cruz","Marshall","Gomez","Murray","Freeman","Wells","Webb","Simpson",
  "Stevens","Tucker","Porter","Hunter","Hicks","Crawford","Henry","Boyd","Mason","Morales",
  "Kennedy","Warren","Dixon","Ramos","Burns","Gordon","Holmes","Rice","Robertson","Hunt",
  "Black","Daniels","Palmer","Mills","Nichols","Grant","Ferguson","Rose","Hawkins","Dunn",
  "Perkins","Hudson","Spencer","Gardner","Stephens","Payne","Pierce","Berry","Matthews","Arnold",
  "Willis","Ray","Watkins","Olson","Carroll","Duncan","Snyder","Hart","Cunningham","Bradley",
  "Andrews","Ruiz","Harper","Fox","Riley","Armstrong","Carpenter","Weaver","Greene","Lawrence",
  "Elliott","Chavez","Sims","Austin","Peters","Kelley","Franklin","Lawson","Fields","Gutierrez",
  "Ryan","Carr","Vasquez","Wheeler","Chapman","Oliver","Montgomery","Richards","Williamson",
  "Johnston","Meyer","Bishop","McCoy","Howell","Alvarez","Morrison","Hansen","Fernandez","Garza",
  "Harvey","Little","Burton","Stanley","Nguyen","George","Jacobs","Reid","Fuller","Lynch","Dean",
  "Gilbert","Garrett","Romero","Welch","Larson","Frazier","Burke","Hanson","Day","Moreno",
  "Bowman","Medina","Fowler","Brewer","Carlson","Pearson","Holland","Douglas","Fleming","Jensen",
  "Vargas","Byrd","Davidson","Hopkins","May","Terry","Herrera","Wade","Soto","Walters","Curtis",
  "Neal","Caldwell","Lowe","Jennings","Barnett","Graves","Jimenez","Horton","Shelton","Barrett",
  "Castro","Sutton","Gregory","McKinney","Lucas","Miles","Craig","Chambers","Holt","Lambert",
  "Fletcher","Watts","Bates","Hale","Rhodes","Pena","Beck","Newman","Haynes","McDaniel","Bush",
  "Parks","Dawson","Santiago","Norris","Hardy","Love","Steele","Curry","Powers","Schultz",
  "Barker","Guzman","Page","Munoz","Ball","Keller","Chandler","Leonard","Walsh","Lyons","Ramsey",
  "Wolfe","Mullins","Benson","Sharp","Bowen","Barber","Cummings","Hines","Baldwin","Griffith",
  "Valdez","Hubbard","Salazar","Warner","Stevenson","Burgess","Tate","Cross","Garner","Mann",
  "Mack","Moss","Thornton","Dennis","McGee","Farmer","Delgado","Aguilar","Vega","Glover","Manning",
  "Harmon","Rodgers","Robbins","Newton","Todd","Blair","Higgins","Ingram","Reese","Cannon",
  "Strickland","Townsend","Potter","Goodwin","Walton","Rowe","Hampton","Ortega","Patton","Swanson",
  "Joseph","Francis","Maldonado","Yates","Erickson","Hodges","Rios","Conner","Adkins","Webster",
  "Norman","Malone","Hammond","Flowers","Cobb","Moody","Quinn","Blake","Maxwell","Pope","Floyd",
  "Osborne","McCarthy","Guerrero","Lindsey","Estrada","Sandoval","Gibbs","Tyler","Gross","Stokes",
  "Doyle","Sherman","Saunders","Wise","Colon","Gill","Greer","Padilla","Simon","Waters","Nunez",
  "Ballard","McBride","Houston","Christensen","Pratt","Briggs","Parsons","McLaughlin","Zimmerman",
  "French","Buchanan","Moran","Copeland","Pittman","Brady","McCormick","Holloway","Brock","Poole",
  "Logan","Bass","Marsh","Wong","Jefferson","Morton","Abbott","Sparks","Norton","Huff","Clayton",
  "Massey","Lloyd","Figueroa","Carson","Bowers","Roberson","Barton","Tran","Lamb","Harrington",
  "Casey","Cortez","Clarke","Mathis","Singleton","Wilkins","Cain","Bryan","Underwood","Hogan",
  "McKenzie","Collier","Luna","Phelps","McGuire","Allison","Bridges","Wilkerson","Nash","Summers",
  "Atkins","Wilcox","Pitts","Conley","Marquez","Burnett","Cochran","Chase","Davenport","Hood",
  "Gates","Clay","Ayala","Roman","Vaughan","Velasquez","Holder","Herring","Wilkinson","Buck",
  "Harden","Lara","Solis","Robles","Cervantes","Ochoa","Suarez","Salinas","Velez","Hidalgo",
  // Irish / Scottish (apostrophes and Mc/Mac)
  "O'Brien","O'Connor","O'Donnell","O'Sullivan","O'Malley","O'Reilly","McDonald","MacDonald",
  "McAllister","McKinnon","McCarthy","McGregor","McKinley","MacIntyre","Fitzgerald","Fitzpatrick",
  // Biblical / Hebrew
  "Cohen","Levi","Solomon","Abrams","Levy","Mendoza","Salem","Friedman","Klein",
  // German / Austrian (BOTH umlaut + ASCII variants)
  "Schmidt","Müller","Mueller","Schneider","Schäfer","Schaefer","Hochuli","Wagner","Becker","Hoffmann",
  "Schulz","Volk","Bauer","Klose","Weber","Fischer","Kraus","Vogel","Schwartz","Hertz",
  "Roth","Brandt","Köhler","Koehler","Größe","Grosse","Häuser","Haeuser","Förster","Foerster",
  // Italian (diacritics + plain)
  "Romano","Rossi","Esposito","Mancini","Russo","Ferrari","Conti","Marino","Bruno","Bianchi",
  "Ricci","Lombardi","Greco","Costa","Bellucci","Capello","D'Amato","D'Angelo","Di Carlo",
  // Polish / Eastern European
  "Lewandowski","Wojcik","Kowalski","Nowak","Krzyzewski","Kubiak","Konecki","Stankowski",
  "Pawlowski","Jankowski","Zielinski","Kaminski","Mazur","Kowalczyk",
  // Hispanic (with accent variants)
  "Garcia","García","Martinez","Martínez","Hernandez","Hernández","Lopez","López","Gonzalez",
  "González","Perez","Pérez","Sanchez","Sánchez","Ramirez","Ramírez","Torres","Rivera","Sosa",
  "Cabrera","Diaz","Díaz","Reyes","Flores","Castillo","Mendez","Méndez","Alvarado","Ortiz",
  // Japanese
  "Tanaka","Suzuki","Sato","Takahashi","Watanabe","Ito","Yamamoto","Nakamura","Kobayashi","Yoshida",
  "Yamada","Sasaki","Matsumoto","Kondo","Saito","Endo","Hayashi","Ishikawa","Shimizu",
  // Korean
  "Kim","Park","Choi","Jung","Kang","Lim","Han","Shin","Yoon","Cho",
  // Polynesian
  "Tagovailoa","Tuilagi","Faaleava","Mahuta","Tavai","Manumaleuna","Tuipulotu","Faleafine","Sapolu",
  "Aumavae","Toilolo","Vaeao",
  // West African
  "Adebayo","Okafor","Nwosu","Mbappe","Mbappé","Diallo","Sissoko","Owusu","Asare","Boateng",
  // Brazilian / Portuguese
  "Silva","Santos","Oliveira","Pereira","Costa","Almeida","Soares","Cardoso",
  // Invented / brand-flavored — adds "alive" feeling without being on-the-nose
  "Apple","Cherry","Maple","Mercedes","Cobra","Lemon","Cadillac","Crowne","Diamond","Ironside",
  "Pomelo","Olive","Brookstone","Aspen","Cypress","Magnolia","Indigo","Ember","Vesper","Onyx",
  // Russian / Slavic surnames
  "Volkov","Petrov","Sokolov","Ivanov","Romanov","Smirnov","Lebedev","Fedorov","Karpov","Sidorov",
  // Indian / South Asian surnames
  "Patel","Singh","Sharma","Reddy","Verma","Khan","Mehta","Nair","Iyer","Chowdhury",
  // Middle Eastern surnames
  "Al-Rashid","Al-Jabbar","Hakim","Khoury","Saleh","Mansour","Nasser",
  // Hawaiian / Pacific surnames
  "Kahuna","Kahale","Mahuta","Nainoa","Kona","Pukui","Kaleo",
  // Greek mythology / classics
  "Atlas","Apollo","Achilles","Ajax","Hercules","Argo","Stavros","Papadopoulos","Kostas","Alexandrou",
  // Roman / Latin
  "Caesar","Augustus","Aurelius","Maximus","Cato","Trajan","Octavian","Cicero","Crassus","Vespasian",
  // Egyptian mythology / pharaonic
  "Ra","Anubis","Horus","Osiris","Sobek","Khepri","Set","Hathor","Ramses","Khufu",
  "Imhotep","Ptolemy","Akhenaten","Thutmose","Senusret",
  // Norse mythology
  "Odinson","Thorson","Lokison","Bjornsson","Eriksson","Magnusson","Olafson",
  // Game of Thrones — house names
  "Stark","Lannister","Targaryen","Baratheon","Greyjoy","Tully","Tyrell","Martell","Arryn","Bolton",
  "Frey","Mormont","Tarly","Tarth","Clegane","Snow","Stone","Sand","Karstark","Umber",
  // Star Wars
  "Skywalker","Solo","Kenobi","Calrissian","Tarkin","Antilles","Fett","Windu","Andor","Wren",
  "Erso","Bridger","Kestis",
  // Lord of the Rings
  "Baggins","Took","Brandybuck","Gamgee","Greenleaf","Greybeard","Hornblower","Stormcrow",
  // Marvel / DC heroes (surnames that work)
  "Stark","Rogers","Banner","Parker","Kent","Wayne","Allen","Garrick","Howlett","Lehnsherr",
  // Breaking Bad / pop crime
  "White","Pinkman","Goodman",
  // Anime
  "Uchiha","Uzumaki","Hatake","Saiyan",
  // Doctor Who
  "Tyler","Smith","Pond",
];

// Creative-style first-name generator — produces things like D'Apple,
// Ja'Marquis, La'Vontay, Tre'Veon, Ke'Sean. Real NFL has tons of these.
const CREATIVE_PREFIXES = ["D'","Ja'","La'","Tre'","Ke'","Da'","De'","Quan'","Te'","Sha'"];
const CREATIVE_ROOTS = [
  "Andre","Marcus","Vontay","Quan","Sean","Marquis","Veon","Maine","Brick","Wayne",
  "Onta","Cobra","Apple","Cherry","Maple","Lemon","Mercedes","Cadillac","Stone","Crowne",
  "Pomelo","Pommel","Veius","Real","Wing","Vine","Vio","Drai","Mahn","Trell","Cion","Reon",
  "Vante","Saun","Shawn","Lonzo","Vontre","Andre","Jhon","Quez","Quavious",
];
function pickFirstName() {
  // 18% chance to roll a creative-style name, otherwise pull from the pool
  if (Math.random() < 0.18) {
    return CREATIVE_PREFIXES[Math.floor(Math.random() * CREATIVE_PREFIXES.length)]
         + CREATIVE_ROOTS[Math.floor(Math.random() * CREATIVE_ROOTS.length)];
  }
  return FIRST[Math.floor(Math.random() * FIRST.length)];
}

// pickLastName() pulls from the pool, with a ~9% chance of producing a
// hyphenated double-barrel surname (e.g., García-Schmidt, Tanaka-O'Brien).
function pickLastName() {
  const a = LAST[Math.floor(Math.random() * LAST.length)];
  if (Math.random() < 0.09) {
    let b = LAST[Math.floor(Math.random() * LAST.length)];
    // Avoid identical halves
    let guard = 0;
    while (b === a && guard++ < 4) b = LAST[Math.floor(Math.random() * LAST.length)];
    // Apostrophe-prefix surnames (O'Brien) don't combine cleanly into a hyphen
    if (b.includes("'") || a.includes("'")) return a;
    return `${a}-${b}`;
  }
  return a;
}

// ── Earned nicknames — limited to true stars (OVR ≥ 85 AND
// MVP/All-Pro/2×PB resume). Roughly 15-30 nicknamed players in any
// era. Pools are NFL-flavored archetypes: animals, vehicles, weather,
// action-movie villains, "Mr. X" — not biblical mythology. Routing
// uses the player's dominant stat to pick a thematically-fitting pool.
// All entries are unique across pools (dedup pass) and the "The X"
// vs "X" pairs are deliberately separated so no two players read as
// "the same guy with/without an article."

// POWER ARM / TRUCK / WALL — earth-shaking, immovable
const NICK_HEAVY     = ["The Cannon","The Howitzer","The Hammer","The Sledge","The Anvil","The Tank","The Bulldozer","The Wrecking Ball","Big Country","The Mountain","The Rhino","The Bull","Earthquake","The Slab","The Battering Ram","The Fortress","The Crusher","Bonecrusher","The Mauler"];
// SPEED — animals + projectiles + weather
const NICK_FAST      = ["The Cheetah","The Burner","Lightning","The Bullet","The Comet","Quicksilver","The Streak","Flash","The Roadrunner","Mach","Greased Lightning","The Phantom","Afterburner","The Jet","Turbo","Warp Speed","The Blur"];
// CEREBRAL / SURGICAL — QBs, route artists, ball-hawks
const NICK_SURGEON   = ["The Surgeon","The Sniper","The Architect","The Maestro","The Conductor","The Professor","The Tactician","Captain Cool","Iceman","The Brain","The Chess Piece","The Mechanic","The Watchmaker","The Cartographer","The Strategist","The Quartermaster","The Bishop","The Calculator"];
// SHOWMAN / TRICKSTER — mobile QBs, elusive RBs/WRs
const NICK_TRICKSTER = ["Houdini","The Magician","The Showman","The Wizard","The Joker","The Snake","The Eel","Spider","Twinkletoes","Skitters","The Ghost","Sleight","The Illusionist","Slippery","Spinmaster","The Escape Artist","Greasy","The Riddler"];
// CLOSER / ASSASSIN — clutch + finishers
const NICK_CLOSER    = ["The Closer","The Finisher","The Sandman","Lights Out","The Reaper","The Predator","Nightmare","The Specter","The Hitman","The Punisher","The Executioner","The Assassin","The Wraith","Game Over","The Undertaker","Doomsday","The Silencer"];
// HANDS / SURE-CATCH — receivers and pickup machines
const NICK_HANDS_NEW = ["Sticky","Sticky Fingers","Velcro","The Vacuum","The Magnet","Captain Catch","The Mitt","The Glove","Touchdown","Gravity","Vise Grip","Suction Cup","The Adhesive","Mr. Mitts","The Net"];
// LOCK / VAULT / SHADOW — shutdown cover guys
const NICK_LOCK      = ["The Lock","The Vault","The Cage","The Cell","Padlock","The Shadow","The Eraser","The Bouncer","The Wall","The Curtain","The Iron Curtain","No Fly Zone","Blackout","Quarantine","The Dungeon","The Trapdoor"];
// THIEF / HAWK — INT-getters, ball production
const NICK_HAWK      = ["The Hawk","Hawkeye","The Thief","The Pickpocket","The Bandit","The Robber","Honey Badger","The Heat","Eagle Eye","The Owl","The Falcon","Larceny","The Highway Patrol","Five-Finger Discount"];
// HUNTER / HEAT-SEEKER — pursuit pass rush + missile-style LBs
const NICK_HUNTER_NEW= ["The Hunter","Heat-Seeker","The Missile","Cruiser","The Strike","The Tracker","The Lurker","The Stalker","The Pursuit","The Sting","Bloodhound","Patriot Missile","The Drone"];
// MR. X / PERSONALITY / VETERAN — captains, cerebral leaders, elder statesmen
const NICK_MISTER    = ["Mr. Reliable","Mr. Clutch","Mr. November","Mr. October","Mr. Sunday","Mr. 4th Quarter","Mr. Steady","Mr. Big Stage","Mr. Everything","The Captain","The General","The Mayor","The Kid","The Mailman","The Statesman","Pops","The Old Man","Greybeard","The Ironhorse","Old Reliable"];
// WEATHER / ELEMENTAL — cannon arms, deep threats, force-of-nature pursuit
const NICK_WEATHER   = ["The Storm","Hurricane","Cyclone","Tsunami","Avalanche","Thunder","Blizzard","Tempest","Tornado","The Squall","Whiteout","Heatwave","Riptide"];
// ANIMAL KINGDOM — beasts beyond cheetah. Pulls hard for speed/elusive/pursuit
const NICK_ANIMAL    = ["Wolf","Mamba","Falcon","Panther","Bear","Cougar","Mongoose","Stallion","Octopus","Buffalo","Tiger","Shark","The Eagle","The Coyote","The Lynx","Grizzly","The Jackal","The Viper"];
// FREAK / SPECIMEN — physical outliers (Calvin Johnson tier). Priority
// boost when player has multiple physical stats ≥95.
const NICK_FREAK     = ["The Freak","The Specimen","The Cyborg","The Android","The Anomaly","The Outlier","The Unicorn","The Mutant","The Alien","Built Different","The Prototype","The Marvel","The Phenomenon"];
// MEGA / ICONIC — for the rare single-name Madonna/Pelé tier
const NICK_ICONIC    = ["Megatron","Beast","Prime","Truck","Mossburger","Skyscraper","Air","Boss","Crash","Volt","Apex","Cobra","T-Rex","Optimus","Vader","Bane","Kingsnake","Smaug","Mach 5"];

// Nickname origin stories — one is picked deterministically (seeded by
// player's legal name hash) per nickname so the lore is stable. Themed
// by pool: speed pool gets speed stories, power pool gets power, etc.
const NICKNAME_ORIGINS = {
  HEAVY: [
    "Pancaked a Pro Bowl linebacker on his first pro snap — the film-room name stuck",
    "Tossed a 320-lb tackle five yards downfield in his rookie debut",
    "Showed up to camp benching 405 — teammates said only one name fit",
    "Buried a corner so hard on a crack-back block the sideline started chanting",
    "Eight tackles for loss in his rookie season opener — the locker room had a name by Monday",
  ],
  FAST: [
    "Posted a 4.28 forty at the combine — the name caught on by Week 2",
    "Outran a Pro Bowl corner by fifteen yards on a screen — the broadcasters needed something to call him",
    "Ran down a 4.4 receiver from behind on a punt return TD",
    "Teammates clocked him on the speed gun at OTAs — the name was inevitable",
    "Took a screen pass 90 yards in his preseason debut — Twitter got there before the team did",
  ],
  SURGEON: [
    "Read a Cover-2 disguise live and audibled into a touchdown — the coordinator coined it",
    "Studied 14 hours of film before training camp opened — his QB started using the name",
    "Diagnosed three blitzes cleanly on the same drive — the booth couldn't stop saying it",
    "Drew up the protection adjustment that won the season opener",
    "Locker-room legend says he memorized the entire opposing playbook in two days",
  ],
  TRICKSTER: [
    "Spun out of three defenders on a screen pass in his rookie preseason",
    "Reversed-fielded a touchdown twice on the same drive",
    "Made a defender whiff so badly the guy fell down before contact",
    "His highlight reel needed a slow-mo replay for one move alone",
    "Faked the throw, kept the ball, ran 60 yards — the call from the sideline stuck",
  ],
  CLOSER: [
    "Sacked the QB on 3rd-and-21 to end the game — the name went on the locker-room wall",
    "Made the strip-sack on the final play of an OT win",
    "Finished three straight drives with a sack — the unit gave him the name",
    "Recovered the game-winning fumble in three consecutive games",
    "Walked off the field after a fourth-down stuff and the chyron just said the name",
  ],
  HANDS_NEW: [
    "Caught 14 passes without a drop in his first four games",
    "Snagged a Hail Mary one-handed on opening day — the booth called the name on air",
    "Equipment manager started writing it on his gloves after a 0-drop month",
    "Caught a deflection off his own facemask in OT and walked it in",
    "Reception streak got so long teammates couldn't remember his given name",
  ],
  LOCK: [
    "Held the #1 WR to twelve yards in his rookie debut",
    "Posted a 0.0 passer-rating-against game — the next morning the name was everywhere",
    "Shut out an All-Pro WR for 60 minutes — Twitter named him by Tuesday",
    "QBs stopped throwing his way midway through Week 5",
    "Three consecutive games with zero catches allowed in coverage",
  ],
  HAWK: [
    "Picked off the QB twice in his first start",
    "Read the QB's eyes on three separate INTs in one game",
    "Snagged a tipped pass off his own cleat in overtime",
    "His pre-snap recognition went viral — Coach said 'that's not coaching, that's instinct'",
    "Stole a route from the receiver's hands and walked it back",
  ],
  HUNTER_NEW: [
    "Ran down a 4.4 RB from across the field — the film analyst coined the name",
    "Chased the QB forty yards on a scramble and finished the sack",
    "Sprinted full-field on a turnover return — the locker room had a name by Monday",
    "GPS data showed his pursuit speed in the 99th percentile leaguewide",
    "His sideline angle in week 2 was so perfect the special teams coach studied it for a year",
  ],
  MISTER: [
    "Started every game from his rookie year — never missed a snap",
    "Stayed late after every practice — vets gave him the name his second year",
    "Showed up to camp three days early every season",
    "Played the final eight games of his rookie year on a torn meniscus",
    "Locker room voted him captain four years running — the title became the name",
  ],
  WEATHER: [
    "Threw four touchdowns in a snow game on Christmas — the broadcast booth gave it to him",
    "Played his best game in a hurricane — the highlight reel went viral that night",
    "Outperformed every other arm in the league during a torrential Week 12",
    "Punter dropped a snap in a blizzard — he tracked it and threw a 40-yard TD",
    "His final drive in a thunderstorm gave him the name on Monday morning",
  ],
  ANIMAL: [
    "Coach said his pursuit angles 'looked like a hunting animal' during film",
    "Outran the secondary on three straight plays — the team name was inevitable",
    "Locker room nicknamed him this after a viral celebration",
    "His college coach started using the name and it followed him to the pros",
    "Combine interview: 'I move like one of these.' Three weeks later it was on the jersey",
  ],
  FREAK: [
    "6'5\", 240lb wide receiver with a 4.38 forty — the combine earned the name",
    "Posted a 42\" vertical and a 6.59 cone — the analytics dept coined it",
    "His combine workout went viral — 'They don't make humans like this'",
    "Pro day was canceled because he 'broke the testing equipment' (he didn't, but the rumor stuck)",
    "Strength coach said 'I've never seen these numbers' — the team announced the name in the press release",
  ],
  ICONIC: [
    "The single-word name became a brand by the end of his rookie year",
    "His rookie highlight reel was so dominant the league office stopped showing it",
    "Madden cover. Sponsorships before the draft. Just 'The Name' — that's how it works",
    "First player in league history to land a signature shoe deal before his second NFL game",
    "Three different broadcasters used the nickname unprompted in the same game — by Tuesday it was everywhere",
  ],
};

// Map a nickname string back to its pool key — used for backfilling
// nickname origin stories on legacy saves where the nickname was
// assigned before the origin field existed.
function _nicknamePoolKey(nick) {
  if (!nick) return null;
  const pools = {
    HEAVY: NICK_HEAVY, FAST: NICK_FAST, SURGEON: NICK_SURGEON,
    TRICKSTER: NICK_TRICKSTER, CLOSER: NICK_CLOSER,
    HANDS_NEW: NICK_HANDS_NEW, LOCK: NICK_LOCK,
    HAWK: NICK_HAWK, HUNTER_NEW: NICK_HUNTER_NEW,
    MISTER: NICK_MISTER, WEATHER: NICK_WEATHER,
    ANIMAL: NICK_ANIMAL, FREAK: NICK_FREAK, ICONIC: NICK_ICONIC,
  };
  for (const [key, pool] of Object.entries(pools)) {
    if (pool.includes(nick)) return key;
  }
  return null;
}

// Deterministic origin pick — seeded by player name hash so the same
// player always gets the same story across reloads.
function _pickNicknameOrigin(player) {
  if (!player?.nickname) return null;
  const poolKey = _nicknamePoolKey(player.nickname);
  if (!poolKey || !NICKNAME_ORIGINS[poolKey]) return null;
  const origins = NICKNAME_ORIGINS[poolKey];
  let h = 0;
  const seed = `${player.name || ""}|${player.nickname}`;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return origins[Math.abs(h) % origins.length];
}

// Pull a nickname from a pool, filtering out any in `taken`. Returns null
// only if the pool is fully exhausted (callers fall through to other pools).
function pickFromPool(pool, taken) {
  if (!taken) return pool[Math.floor(Math.random() * pool.length)];
  const available = pool.filter(n => !taken.has(n));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function pickCareerNickname(player, taken = null) {
  if (!player) return null;
  const [spd, str, agi, awr, thr, cat, blk, prs, cov, tck, kpw] = player.stats;
  const pos = player.position;
  // Position-specific "expected mean" — biggest delta above this is the
  // player's dominant trait.
  const meanByPos = {
    QB: { thr: 78, awr: 78, spd: 72, agi: 72 },
    RB: { spd: 80, str: 76, agi: 78, cat: 70 },
    WR: { spd: 82, agi: 80, cat: 78, awr: 76 },
    TE: { cat: 76, str: 80, blk: 76, spd: 74 },
    OL: { str: 82, blk: 82, agi: 70, awr: 76 },
    DL: { str: 82, prs: 76, spd: 72, tck: 76 },
    LB: { tck: 80, cov: 74, prs: 74, spd: 76 },
    CB: { cov: 82, spd: 82, agi: 80, awr: 76 },
    S:  { cov: 80, spd: 78, tck: 78, awr: 78 },
  };
  const m = meanByPos[pos] || {};
  const statMap = { spd, str, agi, awr, thr, cat, blk, prs, cov, tck };
  let dominant = null, dominantDelta = -Infinity;
  for (const k of Object.keys(m)) {
    const delta = (statMap[k] - m[k]);
    if (delta > dominantDelta) { dominantDelta = delta; dominant = k; }
  }
  // FREAK priority injection: true physical outliers (Calvin Johnson
  // tier) — OVR ≥ 90 AND at least two physical stats ≥ 93 — get the
  // FREAK pool as their FIRST choice, regardless of position archetype.
  // These are "you don't get to be this big AND this fast" players.
  const physicalStats = [spd, str, agi, thr, cat].filter(s => s >= 93).length;
  const isFreak = (player.overall || 0) >= 90 && physicalStats >= 2;
  // Pool routing by (position × dominant stat). Each route returns a
  // priority list — try the first, fall through if exhausted.
  let pools = [];
  if (pos === "QB") {
    if (dominant === "thr")      pools = [NICK_HEAVY, NICK_WEATHER, NICK_CLOSER, NICK_MISTER];
    else if (dominant === "awr") pools = [NICK_SURGEON, NICK_MISTER, NICK_CLOSER];
    else if (dominant === "spd" || dominant === "agi")
                                  pools = [NICK_TRICKSTER, NICK_SURGEON, NICK_ANIMAL];
    else                          pools = [NICK_SURGEON, NICK_MISTER];
  } else if (pos === "RB") {
    if (dominant === "str")      pools = [NICK_HEAVY, NICK_CLOSER, NICK_WEATHER];
    else if (dominant === "spd") pools = [NICK_FAST, NICK_ANIMAL, NICK_HEAVY];
    else if (dominant === "agi") pools = [NICK_TRICKSTER, NICK_ANIMAL, NICK_FAST];
    else if (dominant === "cat") pools = [NICK_HANDS_NEW, NICK_SURGEON];
    else                          pools = [NICK_MISTER, NICK_HEAVY];
  } else if (pos === "WR") {
    if (dominant === "spd")      pools = [NICK_FAST, NICK_ANIMAL, NICK_WEATHER, NICK_TRICKSTER];
    else if (dominant === "cat") pools = [NICK_HANDS_NEW, NICK_SURGEON];
    else if (dominant === "agi") pools = [NICK_TRICKSTER, NICK_ANIMAL, NICK_FAST];
    else if (dominant === "awr") pools = [NICK_SURGEON, NICK_MISTER];
    else                          pools = [NICK_SURGEON, NICK_HANDS_NEW];
  } else if (pos === "TE") {
    if (dominant === "blk")      pools = [NICK_HEAVY, NICK_LOCK];
    else if (dominant === "cat") pools = [NICK_HANDS_NEW, NICK_SURGEON];
    else                          pools = [NICK_MISTER, NICK_HEAVY];
  } else if (pos === "OL") {
    if (dominant === "str" || dominant === "blk")
                                  pools = [NICK_HEAVY, NICK_LOCK, NICK_WEATHER];
    else if (dominant === "awr") pools = [NICK_MISTER, NICK_SURGEON];
    else                          pools = [NICK_HEAVY, NICK_MISTER];
  } else if (pos === "DL") {
    if (dominant === "prs")      pools = [NICK_CLOSER, NICK_HUNTER_NEW, NICK_ANIMAL];
    else if (dominant === "str") pools = [NICK_HEAVY, NICK_CLOSER, NICK_WEATHER];
    else if (dominant === "spd") pools = [NICK_FAST, NICK_HUNTER_NEW, NICK_ANIMAL];
    else                          pools = [NICK_CLOSER, NICK_HEAVY];
  } else if (pos === "LB") {
    if (dominant === "tck")      pools = [NICK_HEAVY, NICK_CLOSER, NICK_WEATHER];
    else if (dominant === "cov") pools = [NICK_LOCK, NICK_SURGEON];
    else if (dominant === "prs") pools = [NICK_CLOSER, NICK_HUNTER_NEW];
    else if (dominant === "spd") pools = [NICK_HUNTER_NEW, NICK_FAST, NICK_ANIMAL];
    else                          pools = [NICK_MISTER, NICK_SURGEON];
  } else if (pos === "CB") {
    if (dominant === "cov")      pools = [NICK_LOCK, NICK_SURGEON];
    else if (dominant === "spd") pools = [NICK_FAST, NICK_ANIMAL, NICK_TRICKSTER];
    else if (dominant === "awr") pools = [NICK_HAWK, NICK_SURGEON];
    else                          pools = [NICK_LOCK, NICK_HAWK];
  } else if (pos === "S") {
    if (dominant === "tck")      pools = [NICK_CLOSER, NICK_HEAVY, NICK_WEATHER];
    else if (dominant === "cov") pools = [NICK_LOCK, NICK_HAWK];
    else if (dominant === "awr") pools = [NICK_MISTER, NICK_HAWK];
    else                          pools = [NICK_HAWK, NICK_LOCK];
  } else {
    pools = [NICK_MISTER];
  }
  // Inject FREAK at the front for physical outliers — Mahomes/Mahomes/
  // Tyreek/Megatron type. Position-archetype pools still fall through
  // if FREAK is exhausted.
  if (isFreak) pools = [NICK_FREAK, ...pools];
  // Try each pool in order; final fallback adds a Roman-numeral suffix.
  for (const pool of pools) {
    const pick = pickFromPool(pool, taken);
    if (pick) return pick;
  }
  // Truly exhausted — suffix fallback
  for (let n = 2; n < 99; n++) {
    const base = NICK_HEAVY[Math.floor(Math.random() * NICK_HEAVY.length)];
    const suffixed = `${base} ${n === 2 ? "II" : n === 3 ? "III" : "IV"}`;
    if (!taken || !taken.has(suffixed)) return suffixed;
  }
  return null;
}

// Assign career nicknames to true league stars. Qualification gate:
// OVR ≥ 85 AND (≥2 Pro Bowls OR ≥1 All-Pro OR ≥1 MVP). ~70% of
// qualifiers acquire one — some elite players never get a nickname
// (Russell Wilson never really had one). Top 5 per position is the
// hard cap so the league doesn't accumulate 30 nicknamed QBs over a
// decade. Result: ~15-30 nicknamed players in any era. Once given,
// nicknames persist forever (no churn).
function assignLeagueNicknames(rosters) {
  const allPlayers = [];
  for (const teamId of Object.keys(rosters)) {
    for (const p of rosters[teamId]) allPlayers.push(p);
  }
  // Resolve duplicate college-earned nicknames first — keep the first
  // occurrence, clear the rest so they get a fresh pick later.
  const seen = new Map();
  for (const p of allPlayers) {
    if (!p.nickname) continue;
    if (seen.has(p.nickname)) {
      p.nickname = null;
      p.collegeNickname = false;
    } else {
      seen.set(p.nickname, p);
    }
  }
  const taken = new Set(seen.keys());
  // Iconic single-name nicknames (Megatron/Pelé tier) — uses a separate
  // restricted pool so they read as a generational icon, not just a
  // longer nickname.
  const takenIconic = new Set(
    [...seen.values()].filter(p => p.goesByNicknameOnly).map(p => p.nickname)
  );

  const _qualifies = (p) =>
    (p.overall || 0) >= 85 &&
    ((p.mvps || 0) >= 1 || (p.allPros || 0) >= 1 || (p.proBowls || 0) >= 2);

  const positions = ["QB","RB","WR","TE","OL","DL","LB","CB","S"];
  for (const pos of positions) {
    const eligible = allPlayers
      .filter(p => p.position === pos && _qualifies(p))
      .sort((a, b) => (b.overall || 0) - (a.overall || 0))
      .slice(0, 5);
    for (const p of eligible) {
      if (p.nickname) continue;
      // ~70% acquisition — some stars stay nameless
      if (Math.random() >= 0.70) continue;
      const nick = pickCareerNickname(p, taken);
      if (!nick) continue;
      p.nickname = nick;
      taken.add(nick);
      p.nicknameOrigin = _pickNicknameOrigin(p);
      // ~3% GOES-BY-NICKNAME-ONLY (Megatron / Pelé / Madonna tier),
      // pulled from a restricted iconic pool so the single name carries
      // the right weight. Flag only — never overwrite p.name (would
      // break every name-keyed lookup in the league).
      if (Math.random() < 0.03 && (p.proBowls || 0) >= 3) {
        const iconic = pickFromPool(NICK_ICONIC, takenIconic);
        if (iconic) {
          p.nickname = iconic;
          taken.add(iconic);
          takenIconic.add(iconic);
          p.goesByNicknameOnly = true;
          p.nicknameOrigin = _pickNicknameOrigin(p);
        }
      }
    }
  }
}

const ROSTER_SLOTS = { QB:3, RB:4, WR:6, TE:3, OL:9, DL:7, LB:6, CB:6, S:5, K:1, P:1 };

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const randf = (a, b) => Math.random() * (b - a) + a;
const randName = () => `${pickFirstName()} ${pickLastName()}`;

// Per-position SPD mapping — real-NFL OL never run 4.40s, CBs are never
// slow. Maps the generic 30-99 SPD roll into position-realistic ranges.
//   OL:     30-61    (median ~45 → 5.28s 40-yd; NFL OL 5.20)
//   DL:     38-86    (median ~62 → 4.97s; NFL DL 4.85)
//   TE/QB:  42-96    (median ~70 → 4.83s; NFL TE 4.70)
//   LB:     50-95    (median ~74 → 4.76s; NFL LB 4.65)
//   RB:     60-99    (median ~80 → 4.65s; NFL RB 4.50)
//   WR/CB:  62-99    (median ~82 → 4.61s; NFL WR/CB 4.45-4.50)
//   S:      55-99    (median ~76 → 4.72s; NFL S 4.55)
// Applied AFTER the base stat generation + flavor pass. Other stat caps
// (STR/BLK/CAT/COV mins/maxes per position) baked into POSITION_PHYSICAL_CAPS.
// Calibrated to land median 40-yd at NFL position averages after the
// post-flavor cap pass:
//   OL 5.20  DL 4.85  TE 4.70  QB 4.85  LB 4.65
//   RB 4.50  WR 4.50  CB 4.45  S 4.55
// Higher offset = faster floor; lower scale = compressed spread.
// Skill positions get higher floors so even average-tier players land
// in the realistic NFL range (a "good"-tier WR shouldn't run a 4.85).
const POSITION_SPD_MAP = {
  OL: { offset: 30, scale: 0.45 },
  DL: { offset: 38, scale: 0.70 },
  TE: { offset: 44, scale: 0.74 },
  QB: { offset: 42, scale: 0.78 },
  LB: { offset: 52, scale: 0.62 },
  WR: { offset: 68, scale: 0.48 },
  CB: { offset: 70, scale: 0.46 },
  RB: { offset: 65, scale: 0.50 },
  S:  { offset: 60, scale: 0.55 },
  // Kickers/punters — NFL athletes-at-position run 5.0-5.3s 40. Without
  // a cap, an "elite" tier K with raw SPD 89 would map to 4.49s (faster
  // than CBs). Compressed scale + low offset keeps K/P in the 5.0-5.4s
  // range regardless of base stat roll.
  K:  { offset: 30, scale: 0.30 },
  P:  { offset: 32, scale: 0.32 },
};
// Non-SPD position caps — STR/BLK/CAT/COV upper/lower bounds per NFL norms.
// These affect bench, hands-on tests, and coverage ratings. OL can't have
// elite COV; QBs don't have elite STR; CBs aren't bench-press monsters.
const POSITION_PHYSICAL_CAPS = {
  // Index legend: 0=SPD 1=STR 2=AGI 3=AWR 4=THR 5=CAT 6=BLK 7=PRS 8=COV 9=TCK 10=KPW
  QB:  { 1:{max:80, min:55}, 3:{min:70}, 4:{min:72}, 6:{max:50}, 9:{max:55} },
  RB:  { 1:{min:60}, 2:{min:70}, 3:{min:65}, 8:{max:65} },
  WR:  { 1:{min:50, max:80}, 2:{min:75}, 5:{min:70}, 6:{max:55} },
  TE:  { 1:{min:70}, 3:{min:70}, 6:{min:65} },
  OL:  { 1:{min:75}, 3:{min:68}, 5:{max:55}, 6:{min:75}, 8:{max:45} },
  DL:  { 1:{min:75}, 3:{min:68}, 5:{max:55}, 7:{min:65}, 8:{max:55}, 9:{min:65} },
  LB:  { 1:{min:70}, 2:{min:70}, 3:{min:72}, 8:{min:60}, 9:{min:75} },
  CB:  { 1:{max:78}, 2:{min:68}, 3:{min:65}, 6:{max:50}, 8:{min:60} },
  S:   { 1:{max:88, min:60}, 2:{min:72}, 3:{min:75}, 8:{min:70}, 9:{min:72} },
  // K/P: leg power (KPW=10) and accuracy (AWR=3) are the position's "arm" — they
  // dominate OVR (43% + 42%), so they MUST be genetic-gated like SPD/THR at other
  // positions. Floor preserved (weak-leg specialists exist); ceiling capped at 90
  // so a generational leg (>90) is a rare draft-day gift, not the norm — matches
  // how 90+ THR is rare at QB. Post-stamp _kpKickerGate (below) thins the upper
  // tail further so 90+ KPW or AWR is genuinely scarce (≈1 in 8 kickers, not 1
  // in 4). Effect: a 99 kicker now requires near-max KPW + near-max AWR + peak
  // dev — same difficulty as 99 anywhere else.
  K:   { 1:{max:60}, 3:{max:90}, 6:{max:30}, 9:{max:40}, 10:{min:60, max:90} },
  P:   { 1:{max:60}, 3:{max:90}, 6:{max:30}, 9:{max:40}, 10:{min:56, max:90} },
};
function _applyPositionCaps(pos, stats) {
  // 1. Map SPD into position-realistic range
  const spdMap = POSITION_SPD_MAP[pos];
  if (spdMap) {
    stats[0] = Math.round(spdMap.offset + (stats[0] - 30) * spdMap.scale);
    stats[0] = Math.max(25, Math.min(99, stats[0]));
  }
  // 2. Apply non-SPD min/max caps
  const caps = POSITION_PHYSICAL_CAPS[pos];
  if (caps) {
    for (const [idxStr, c] of Object.entries(caps)) {
      const idx = +idxStr;
      if (c.max != null && stats[idx] > c.max) stats[idx] = c.max;
      if (c.min != null && stats[idx] < c.min) stats[idx] = c.min;
    }
  }
  // K/P upper-tail thinning on KPW (10) and AWR (3) — the two stats that drive
  // K/P OVR (43% + 42%). Flat caps at 90 (above) created a pile; we want a
  // continuous tail where 90+ is genuinely rare. Re-draw any 88+ value through
  // a softening curve so the tail thins like other positions' THR/SPD elites:
  // 88-92 zone keeps a bell shape, 93+ requires hitting a small probability gate.
  if (pos === "K" || pos === "P") {
    for (const i of [3, 10]) {
      const v = stats[i] || 60;
      if (v >= 88) {
        // Two-stage gate: most "elite" rolls land 85-90; the true 93+ tail is rare.
        const r = Math.random();
        if      (r < 0.50) stats[i] = 84 + Math.floor(Math.random() * 5);     // 84-88
        else if (r < 0.85) stats[i] = 88 + Math.floor(Math.random() * 4);     // 88-91
        else if (r < 0.97) stats[i] = 92 + Math.floor(Math.random() * 3);     // 92-94
        else               stats[i] = 95 + Math.floor(Math.random() * 5);     // 95-99 (rare)
      }
    }
  }
  return stats;
}
function statsFor(pos, tier) {
  // Path A refactor: added "scrub" tier — truly low-OVR prospects for
  // CAMP-grade injection in draft class filler. Without this, the
  // bell-curve OVR distribution in genPlayer leaves the bottom tail
  // (OVR <55) starved. "scrub" prospects have OVR ~30-48 — real
  // undraftable camp bodies, "long shot" UDFA invitees. Used only by
  // draft class filler so existing systems (NFL rosters, FA pool) are
  // unaffected.
  const r = {
    elite:   { lo:78, hi:99 },
    good:    { lo:65, hi:88 },     // widened upper bound 80 → 88; fills the OVR 80-84 gap that was bimodal vs elite (was producing OVR ~73)
    average: { lo:50, hi:72 },     // widened slightly to keep continuity with new "good"
    poor:    { lo:35, hi:54 },
    scrub:   { lo:25, hi:42 },
  }[tier];
  const b = () => rand(r.lo, r.hi);
  // Lesser stats — secondary attributes below the primary range.
  // Floor kept at r.lo so secondary stats never go absurdly low, but
  // always stay below the primary ceiling so they can't inflate OVR.
  const l = () => rand(Math.max(r.lo, 30), Math.max(r.hi - 10, r.lo + 5));
  let stats;
  // stats[11] = TEC (technique/execution). Placeholder here — overridden by
  // applyFlavor (flavor-based) and genPlayer (archetype-based) immediately after.
  switch (pos) {
    case "QB": stats = [l(),l(),b(),b(),b(),l(),l(),l(),l(),l(),l(),l()]; break;
    case "RB": stats = [b(),b(),b(),b(),l(),b(),l(),l(),l(),l(),l(),l()]; break;
    case "WR": stats = [b(),l(),b(),b(),l(),b(),l(),l(),b(),l(),l(),l()]; break;
    case "TE": stats = [b(),b(),b(),b(),l(),b(),b(),l(),l(),l(),l(),l()]; break;
    case "OL": stats = [l(),b(),b(),b(),l(),l(),b(),l(),l(),l(),l(),l()]; break;
    case "DL": stats = [b(),b(),b(),b(),l(),l(),l(),b(),l(),b(),l(),l()]; break;
    case "LB": stats = [b(),b(),b(),b(),l(),l(),l(),b(),b(),b(),l(),l()]; break;
    case "CB": stats = [b(),l(),b(),b(),l(),l(),l(),l(),b(),b(),l(),l()]; break;
    case "S":  stats = [b(),b(),b(),b(),l(),l(),l(),l(),b(),b(),l(),l()]; break;
    default:   stats = [l(),l(),l(),b(),l(),l(),l(),l(),l(),l(),b(),l()];
  }
  // Signature stat — every player has at least one calling card. Picks a
  // random stat and ensures it lands in the 70-85 range so even "poor" tier
  // guys can be "the guy with the strong arm" or "the speedster off the bench."
  // Signature stat: every player has a calling card, but the ceiling
  // scales with tier so poor-tier UDFAs don't land near starter range.
  const sigCount = (tier === "poor" || tier === "average" || tier === "scrub") ? 2 : 1;
  const sigMin = tier === "elite" ? 82 : tier === "good" ? 74 : tier === "average" ? 66 : tier === "poor" ? 58 : 45;
  const sigMax = tier === "elite" ? 95 : tier === "good" ? 84 : tier === "average" ? 76 : tier === "poor" ? 68 : 55;
  for (let i = 0; i < sigCount; i++) {
    const idx = rand(0, stats.length - 1);
    const sigVal = rand(sigMin, sigMax);
    if (stats[idx] < sigVal) stats[idx] = sigVal;
  }
  // POLARIZATION (50% of prospects): push 2 stats toward top of tier
  // range, push 2 stats toward bottom. Creates within-tier OVR variance
  // — some prospects end at top of tier (peaky), some at bottom (flat).
  // Net effect: bell-curve OVR distribution becomes more bimodal because
  // each tier produces a wider OVR spread.
  if (Math.random() < 0.50) {
    const range = r.hi - r.lo;
    const peakLo = r.lo + Math.round(range * 0.7);   // top 30% of tier range
    const valleyHi = r.lo + Math.round(range * 0.3); // bottom 30%
    const used = new Set();
    // 2 peaks
    for (let i = 0; i < 2; i++) {
      let idx;
      let attempts = 0;
      do { idx = rand(0, stats.length - 1); attempts++; } while (used.has(idx) && attempts < 10);
      used.add(idx);
      stats[idx] = Math.max(stats[idx], rand(peakLo, r.hi));
    }
    // 2 valleys (different from peaks)
    for (let i = 0; i < 2; i++) {
      let idx;
      let attempts = 0;
      do { idx = rand(0, stats.length - 1); attempts++; } while (used.has(idx) && attempts < 10);
      used.add(idx);
      stats[idx] = Math.min(stats[idx], rand(r.lo, valleyHi));
    }
  }
  // Position-aware physical caps — clamps SPD/STR/COV/etc into realistic
  // NFL ranges per position. OL can't run 4.40, CBs can't be slow, QBs
  // don't bench at the combine. Applied AFTER all randomization (sig stat,
  // polarization) so the caps win.
  _applyPositionCaps(pos, stats);
  return stats;
}

// Flavor for bad players — they're never UNIFORMLY bad. They're either
// freak athletes with no football brain, or cerebral types with limited
// physical tools. Adds personality + makes scouting actually matter.
const PLAYER_FLAVORS = {
  RAW_ATHLETE:   { label: "Raw athlete",   blurb: "Elite tools, raw instincts" },
  HIGH_FOOTBALL_IQ: { label: "High football IQ", blurb: "Smart, schematic — physically limited" },
};
function applyFlavor(stats, pos) {
  // Returns the flavor key (or null) and mutates stats in place
  const r = Math.random();
  // Indices: 0=SPD, 1=STR, 2=AGI, 3=AWR, 4=THR, 5=CAT, 6=BLK, 7=PRS, 8=COV, 9=TCK, 10=KPW, 11=TEC
  if (r < 0.45) {
    // RAW_ATHLETE: elite physical tools, poor reads. High TEC — natural physical
    // execution is their calling card even if their football IQ lags.
    stats[0] = Math.max(stats[0], rand(68, 80));   // SPD
    stats[1] = Math.max(stats[1], rand(65, 78));   // STR
    stats[2] = Math.max(stats[2], rand(68, 80));   // AGI
    stats[3] = Math.min(stats[3], rand(35, 50));   // AWR (poor instincts)
    stats[11] = rand(68, 82);                       // TEC high — body does the right thing naturally
    if (pos === "QB") stats[4] = Math.min(stats[4], rand(45, 60));
    if (pos === "WR" || pos === "TE") stats[5] = Math.min(stats[5], rand(45, 60));
    if (pos === "CB" || pos === "S") stats[8] = Math.min(stats[8], rand(45, 58));
    return "RAW_ATHLETE";
  } else if (r < 0.90) {
    // HIGH_FOOTBALL_IQ: sharp reads, physically limited. Lower TEC — they know
    // what to do but the execution isn't always clean.
    stats[3] = Math.max(stats[3], rand(78, 92));   // AWR
    stats[11] = rand(48, 65);                       // TEC lower — mechanics are rougher
    stats[0] = Math.min(stats[0], rand(42, 55));   // SPD
    stats[1] = Math.min(stats[1], rand(45, 58));   // STR
    stats[2] = Math.min(stats[2], rand(45, 58));   // AGI
    if (pos === "QB") stats[4] = Math.max(stats[4], rand(75, 88));
    if (pos === "WR" || pos === "TE") stats[5] = Math.max(stats[5], rand(78, 92));
    if (pos === "CB" || pos === "S" || pos === "LB") stats[8] = Math.max(stats[8], rand(75, 90));
    if (pos === "OL") stats[6] = Math.max(stats[6], rand(78, 92));
    if (pos === "DL" || pos === "LB") stats[7] = Math.max(stats[7], rand(75, 88));
    return "HIGH_FOOTBALL_IQ";
  }
  return null;
}
function calcOverall(pos, s) {
  const [spd,str,agi,awr,thr,cat,blk,prs,cov,tck,kpw] = s;
  // TEC (technique/execution) — stats[11]. Default 68 for saves predating this stat.
  const tec = s[11] ?? 68;
  let v;
  // TEC contributes 15% to every position. Physical/skill weights reduced proportionally.
  // For trench positions (OL/DL/LB/RB/TE), AWR is NOT in the OVR formula — it feeds
  // engine behavior (snap timing, gap reads, blitz pickup) instead.
  switch (pos) {
    // QB: ACCURACY-DRIVEN model. THR (arm) cut 46% → 24% and FROZEN out of the
    // dev pools — arm strength is a physical/genetic trait (like SPD), not
    // coachable. AWR (accuracy/processing) raised 24% → 38% and TEC (technique/
    // footwork) 17% → 28% — these are the coachable core that drives development.
    // Effect: an average-arm, elite-accuracy QB (Brady/Brees) can now reach
    // top-5 OVR; a cannon with poor accuracy can't. Arm still matters (24%) and
    // is decisive for the DEEP ball via the engine's depth-weighted completion +
    // underthrow (raw THR), but it no longer inflates to 99 on every developed QB.
    case "QB": v = spd*4+agi*6+awr*40+thr*18+tec*32;  break;
    case "RB": v = spd*30+str*17+agi*21+cat*17+tec*15; break;
    case "WR": v = spd*26+agi*21+cat*30+awr*8+tec*15;  break;
    case "TE": v = spd*17+cat*34+blk*25+str*9+tec*15;  break;
    case "OL": v = str*30+blk*38+agi*17+tec*15;        break;
    case "DL": v = str*30+prs*34+spd*21+tec*15;        break;
    case "LB": v = prs*21+cov*22+tck*26+spd*16+tec*15; break;
    case "CB": v = spd*26+agi*21+cov*30+awr*8+tec*15;  break;
    case "S":  v = spd*21+cov*30+tck*26+awr*8+tec*15;  break;
    // K/P: same OVR formula and cap as everyone else (99) — was capped at 95 to
    // hide the inflation problem, which piled would-be 96-99 kickers at exactly
    // 95. Now that KPW and AWR are properly gated (rare-high genetic leg + decline
    // that fades veterans), a 99 kicker is possible but as rare as any other 99:
    // it requires a generational leg, elite accuracy, and a peak career year.
    default:   v = kpw*43 + awr*42 + tec*15;
  }
  return Math.min(99, Math.max(40, Math.round(v / 100)));
}
// ─── Trench archetypes & rock-paper-scissors matchup matrix ─────────────
// Each DL has a fighting style with signature pass-rush moves. Each OL has
// a build that handles certain styles well and others poorly. Matchup table
// returns a multiplier on this rep's pressure / sack chance.
const DL_ARCHETYPES = {
  POWER:      { label: "Power",        blurb: "Bull rusher — drives O-line back",          moves: ["BULL RUSH", "CLUB-RIP", "LONG ARM"] },
  SPEED:      { label: "Speed",        blurb: "Edge bender — wins with first step",        moves: ["SPEED RUSH", "DIP-AND-RIP", "GHOST"] },
  TWEENER:    { label: "Tweener",      blurb: "Undersized — beats power w/ tech + speed",  moves: ["SWIM", "SPIN", "CROSS CHOP"] },
  PENETRATOR: { label: "Penetrator",   blurb: "Explosive 3-tech — blows up the pocket",    moves: ["PIERCE", "STAB", "GET-OFF"] },
  TECHNICIAN: { label: "Technician",   blurb: "Hand-fighter — wins reps with footwork",    moves: ["HAND FIGHT", "COUNTER", "ARM-OVER"] },
};
const DL_ARCHETYPE_KEYS = Object.keys(DL_ARCHETYPES);
const OL_ARCHETYPES = {
  ANCHOR:     { label: "Anchor",       blurb: "Stout, immovable — eats bull rushes" },
  ATHLETIC:   { label: "Athletic",     blurb: "Quick feet, mirrors speed rushers" },
  TECHNICIAN: { label: "Technician",   blurb: "Disciplined hands, wins the leverage battle" },
  PLUG:       { label: "Plug",         blurb: "Short + squat, low base, hard to swim over" },
  MAULER:     { label: "Mauler",       blurb: "Road grader — destroys in the run game" },
};
const OL_ARCHETYPE_KEYS = Object.keys(OL_ARCHETYPES);

// Pass-rush multiplier — values >1 favor the rusher, <1 favor the blocker.
const PASS_MATCHUP = {
  POWER:      { ANCHOR: 0.70, ATHLETIC: 1.32, TECHNICIAN: 1.05, PLUG: 0.90, MAULER: 1.15 },
  SPEED:      { ANCHOR: 1.30, ATHLETIC: 0.68, TECHNICIAN: 1.00, PLUG: 1.12, MAULER: 1.28 },
  TWEENER:    { ANCHOR: 1.18, ATHLETIC: 1.08, TECHNICIAN: 0.72, PLUG: 1.05, MAULER: 1.30 },
  PENETRATOR: { ANCHOR: 1.10, ATHLETIC: 0.78, TECHNICIAN: 0.95, PLUG: 1.28, MAULER: 1.05 },
  TECHNICIAN: { ANCHOR: 0.82, ATHLETIC: 1.05, TECHNICIAN: 1.12, PLUG: 1.05, MAULER: 1.28 },
};
// Run-blocking multiplier — values >1 favor offense (better gap), <1 favor defense (stuffed).
const RUN_MATCHUP = {
  POWER:      { ANCHOR: 0.95, ATHLETIC: 1.10, TECHNICIAN: 1.05, PLUG: 0.80, MAULER: 1.15 },
  SPEED:      { ANCHOR: 1.20, ATHLETIC: 1.05, TECHNICIAN: 1.05, PLUG: 1.10, MAULER: 1.20 },
  TWEENER:    { ANCHOR: 1.15, ATHLETIC: 1.10, TECHNICIAN: 0.95, PLUG: 1.05, MAULER: 1.20 },
  PENETRATOR: { ANCHOR: 1.05, ATHLETIC: 1.10, TECHNICIAN: 0.95, PLUG: 0.75, MAULER: 1.00 },
  TECHNICIAN: { ANCHOR: 1.05, ATHLETIC: 1.10, TECHNICIAN: 1.05, PLUG: 0.95, MAULER: 1.18 },
};

function pickDLArchetype(stats) {
  // Bias archetype by stats: high speed → SPEED, high strength → POWER, etc.
  const [spd, str, agi, awr, _thr, _cat, _blk, prs] = stats;
  const weights = {
    POWER:      Math.max(0, str - 60) + Math.max(0, prs - 65) * 0.5,
    SPEED:      Math.max(0, spd - 55) * 1.2 + Math.max(0, agi - 55) * 0.5,
    TWEENER:    Math.max(0, (spd + agi) / 2 - 50) + (str < 75 ? 8 : 0),
    PENETRATOR: Math.max(0, spd - 60) + Math.max(0, prs - 60),
    TECHNICIAN: Math.max(0, awr - 60) * 1.4 + Math.max(0, agi - 55) * 0.5,
  };
  // Add noise so it's not too deterministic
  for (const k in weights) weights[k] += Math.random() * 8;
  return Object.keys(weights).reduce((a, b) => weights[a] >= weights[b] ? a : b);
}
function pickOLArchetype(stats) {
  const [spd, str, agi, awr, _thr, _cat, blk] = stats;
  const weights = {
    ANCHOR:     Math.max(0, str - 55) * 1.4 + (spd < 60 ? 6 : 0),
    ATHLETIC:   Math.max(0, spd - 50) * 1.5 + Math.max(0, agi - 55) * 0.8,
    TECHNICIAN: Math.max(0, awr - 55) * 1.5 + Math.max(0, blk - 60) * 0.8,
    PLUG:       (str > 60 && spd < 60 ? 12 : 4),
    MAULER:     Math.max(0, str - 60) + Math.max(0, blk - 60) * 1.3,
  };
  for (const k in weights) weights[k] += Math.random() * 7;
  return Object.keys(weights).reduce((a, b) => weights[a] >= weights[b] ? a : b);
}

// ─── Skill-position archetypes ─────────────────────────────────────────
const QB_ARCHETYPES = {
  POCKET:      { label: "Pocket Passer", blurb: "Patient dropback — picks his spots" },
  GUNSLINGER:  { label: "Gunslinger",    blurb: "Aggressive shot-taker — chunk plays + INTs" },
  GAME_MANAGER:{ label: "Game Manager",  blurb: "Conservative — checks down, protects the ball" },
  DUAL_THREAT: { label: "Dual Threat",   blurb: "Mobile — scrambles when pressured" },
  FIELD_GENERAL:{label: "Field General", blurb: "Reads matchups — patient, lowest INTs" },
};
// Archetype is the PLAY-STYLE axis (drives engine aggression, targeting,
// deep-shot rate) — decoupled from stat shape. Any skill level can be any
// style, so all five labels are reachable at the legend tier. Exception:
// DUAL_THREAT keeps a hard SPD/AGI gate, since "scrambler" requires legs.
function pickQBArchetype(stats) {
  const [spd, _str, agi, awr, thr] = stats;
  const w = {
    POCKET:        15 + Math.max(0, thr - 75) * 0.3,
    GUNSLINGER:    10 + Math.max(0, thr - 80) * 0.4,
    GAME_MANAGER:  10 + Math.max(0, awr - 75) * 0.3,
    DUAL_THREAT:    0 + Math.max(0, spd - 75) * 1.2 + Math.max(0, agi - 75) * 0.4,
    FIELD_GENERAL: 10 + Math.max(0, awr - 80) * 0.4,
  };
  for (const k in w) w[k] += Math.random() * 25;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}

// Stat profile per QB archetype — offsets from the target overall.
// Tuned so that the weighted average (0.1*SPD + 0.15*AGI + 0.25*AWR + 0.5*THR)
// of the offsets ≈ 0, then we solve for THR exactly to nail the target OVR.
const QB_ARCH_PROFILES = {
  POCKET:       { spd: -28, agi: -18, awr: +2,  thr: +12, blurb: "Statue with a cannon" },
  GUNSLINGER:   { spd: -12, agi: -10, awr: -12, thr: +14, blurb: "Big arm, low awareness" },
  GAME_MANAGER: { spd: -18, agi: -10, awr: +14, thr: -4,  blurb: "Smart, weaker arm" },
  DUAL_THREAT:  { spd: +12, agi: +14, awr: -6,  thr: -6,  blurb: "Mobile, average arm" },
  FIELD_GENERAL:{ spd: -12, agi: -6,  awr: +14, thr: +4,  blurb: "Smart and accurate" },
};
function genTestQB(arch, targetOvr) {
  const prof = QB_ARCH_PROFILES[arch];
  const jit = () => rand(-2, 2);
  const clamp = (v) => Math.min(99, Math.max(35, Math.round(v)));
  const spd = clamp(targetOvr + prof.spd + jit());
  const agi = clamp(targetOvr + prof.agi + jit());
  const awr = clamp(targetOvr + prof.awr + jit());
  // Solve THR so weighted overall == target: 0.1*spd + 0.15*agi + 0.25*awr + 0.5*thr = target
  const thr = clamp((targetOvr - 0.1*spd - 0.15*agi - 0.25*awr) / 0.5);
  const str = clamp(targetOvr - 25 + jit());
  // Non-overall stats: middling filler
  const filler = () => rand(45, 60);
  const stats = [spd, str, agi, awr, thr, filler(), filler(), filler(), filler(), filler(), filler()];
  return {
    name: `${QB_ARCHETYPES[arch].label} (Test)`,
    position: "QB",
    age: 27,
    stats,
    overall: calcOverall("QB", stats),
    archetype: arch,
  };
}

const RB_ARCHETYPES = {
  POWER:     { label: "Power Back",  blurb: "Bruiser — breaks tackles, more fumbles, shorter career" },
  ELUSIVE:   { label: "Elusive",     blurb: "Jukes and spins — high YAC, durable" },
  SPEED:     { label: "Speed Back",  blurb: "Home-run hitter — chunk plays but boom/bust" },
  WORKHORSE: { label: "Workhorse",   blurb: "Every-down back — balanced, durable" },
  RECEIVING: { label: "3rd-Down RB", blurb: "Pass-catching specialist — dump-offs and screens" },
};
const WR_ARCHETYPES = {
  DEEP_THREAT: { label: "Deep Threat", blurb: "Speed receiver — big plays but lower catch%" },
  POSSESSION:  { label: "Possession",  blurb: "Reliable hands — short routes, high catch%" },
  SLOT:        { label: "Slot",        blurb: "Quick, shifty — YAC monster on quick game" },
  RED_ZONE:    { label: "Red Zone",    blurb: "Big-bodied — jump-ball winner, low YAC" },
  ROUTE_RUNNER:{ label: "Route Runner",blurb: "Technician — gets open against tight coverage" },
};
const TE_ARCHETYPES = {
  RECEIVING: { label: "Receiving TE", blurb: "Like a big WR — weak blocker" },
  BLOCKING:  { label: "Blocking TE",  blurb: "Sixth lineman — boosts run game, rare target" },
  HYBRID:    { label: "Hybrid",       blurb: "Balanced — does a bit of both" },
};
const LB_ARCHETYPES = {
  THUMPER:    { label: "Thumper",       blurb: "Run-stopper — heavy hitter, weak in coverage" },
  COVER:      { label: "Cover LB",      blurb: "Sideline-to-sideline — drops into pass coverage" },
  BLITZER:    { label: "Blitzer",       blurb: "Pass rusher — gets after the QB" },
  SIGNAL:     { label: "Signal-caller", blurb: "Smart anchor — calls plays, balanced" },
  HEADHUNTER: { label: "Headhunter",    blurb: "Big-hit enforcer — devastating contact, ejection risk" },
  HYBRID:     { label: "Hybrid",        blurb: "Three-down LB — tackles + coverage" },
};
const CB_ARCHETYPES = {
  SHUTDOWN: { label: "Shutdown",  blurb: "Locks down WRs — QBs avoid him" },
  BALL_HAWK:{ label: "Ball Hawk", blurb: "Gambles — lots of INTs, also lots of give-ups" },
  PHYSICAL: { label: "Press",     blurb: "Jams at the line — disruptive, slower deep" },
  SLOT_CB:  { label: "Slot CB",   blurb: "Quick — covers slot WRs, blitzes" },
  ZONE:     { label: "Zone",      blurb: "Disciplined — fewer big plays allowed" },
};
const S_ARCHETYPES = {
  BALL_HAWK:    { label: "Ball Hawk",    blurb: "Range + nose for the ball — high INTs" },
  BOX:          { label: "Box Safety",   blurb: "Extra LB — tackle machine in the box" },
  CENTER_FIELD: { label: "Center Field", blurb: "Deep coverage — prevents big plays" },
  HEADHUNTER:   { label: "Headhunter",   blurb: "Big-hit enforcer — devastating contact, ejection risk" },
  HYBRID:       { label: "Hybrid",       blurb: "Plays single-high or in the box equally well" },
};
// Kicker archetypes — affect FG accuracy, range, and kickoff distance.
const K_ARCHETYPES = {
  LEG:       { label: "Big Leg",   blurb: "Long-range threat — 60+ yd FGs in play, but a hair less accurate" },
  PRECISION: { label: "Precision", blurb: "Money inside 45 — fewer big-leg kicks but rarely shanks one" },
  CLUTCH:    { label: "Clutch",    blurb: "Comes through when it matters — better in 4th Q close games" },
  BALANCED:  { label: "Balanced",  blurb: "No real weakness — a steady veteran" },
};
// Punter archetypes — affect distance, hang time, and directional pinning.
const P_ARCHETYPES = {
  BOOMER:      { label: "Boomer",      blurb: "Crushes it — long average, but more touchbacks" },
  DIRECTIONAL: { label: "Directional", blurb: "Pinpoint coffin-corner — short but high fair-catch rate" },
  HANG_TIME:   { label: "Hang Time",   blurb: "Sky kicks — minimal return yards, average distance" },
  ATHLETE:     { label: "Athletic",    blurb: "Trick-play threat — can run or throw on fake punts" },
  BALANCED:    { label: "Balanced",    blurb: "Solid all-around — no weakness, no signature trait" },
};

function pickRBArchetype(stats) {
  const [spd, str, agi, awr, _thr, cat] = stats;
  const w = {
    POWER:     Math.max(0, str - 55) * 1.5 + (spd < 70 ? 4 : 0),
    ELUSIVE:   Math.max(0, agi - 60) * 1.4 + Math.max(0, awr - 55) * 0.5,
    SPEED:     Math.max(0, spd - 70) * 1.6 + (str < 70 ? 4 : 0),
    WORKHORSE: 6 + Math.max(0, awr - 60),
    RECEIVING: Math.max(0, cat - 60) * 1.6 + Math.max(0, agi - 55) * 0.5,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickWRArchetype(stats) {
  const [spd, str, agi, awr, _thr, cat] = stats;
  const w = {
    DEEP_THREAT:  Math.max(0, spd - 70) * 1.5,
    POSSESSION:   Math.max(0, cat - 65) * 1.4 + Math.max(0, awr - 60) * 0.6,
    SLOT:         Math.max(0, agi - 65) * 1.4 + Math.max(0, spd - 65) * 0.5,
    RED_ZONE:     Math.max(0, str - 55) * 1.6 + Math.max(0, cat - 55) * 0.5,
    ROUTE_RUNNER: Math.max(0, awr - 60) * 1.4 + Math.max(0, agi - 55) * 0.5,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickTEArchetype(stats) {
  const [_spd, str, _agi, _awr, _thr, cat, blk] = stats;
  // Specialists are penalized when the OTHER dimension is also strong (a true
  // receiving TE blocks poorly and vice-versa); HYBRID rewards being good at
  // BOTH, so a well-rounded elite TE lands HYBRID instead of being forced into
  // a specialist label and capped at low OVR (the old flat 8 only ever won for
  // mediocre players).
  const w = {
    RECEIVING: Math.max(0, cat - 55) * 1.5 - Math.max(0, blk - 62) * 0.5,
    BLOCKING:  Math.max(0, blk - 55) * 1.4 + Math.max(0, str - 55) * 0.5 - Math.max(0, cat - 62) * 0.5,
    HYBRID:    Math.max(0, Math.min(cat, blk) - 58) * 1.7,
  };
  for (const k in w) w[k] += Math.random() * 5;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickLBArchetype(stats) {
  const [spd, str, _agi, awr, _thr, _cat, _blk, prs, cov, tck] = stats;
  const w = {
    THUMPER: Math.max(0, str - 55) * 1.3 + Math.max(0, tck - 60) * 0.7,
    COVER:   Math.max(0, cov - 55) * 1.4 + Math.max(0, spd - 60) * 0.6,
    BLITZER: Math.max(0, prs - 60) * 1.4 + Math.max(0, spd - 55) * 0.5,
    SIGNAL:  Math.max(0, awr - 60) * 1.4,
    // Headhunter: high STR + TCK + SPD trifecta — Ray Lewis / Brian Dawkins
    // profile. Gated to elites; cov < 70 keeps coverage LBs from qualifying.
    HEADHUNTER: (str >= 78 && tck >= 75 && spd >= 70 && cov < 70)
                ? Math.max(0, str - 70) * 1.0 + Math.max(0, tck - 70) * 0.8 + Math.max(0, spd - 65) * 0.5
                : 0,
    // True 3-down LB — wins when coverage AND tackling AND some rush are all
    // solid (the weakest of the three drives it). Scales with talent so a
    // well-rounded LB lands HYBRID at a real OVR, not just balanced scrubs.
    HYBRID:  10 + Math.max(0, Math.min(cov, Math.min(tck, prs + 8)) - 58) * 1.8,
  };
  for (const k in w) w[k] += Math.random() * 5;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickCBArchetype(stats) {
  const [spd, str, agi, awr, _thr, _cat, _blk, _prs, cov] = stats;
  const w = {
    SHUTDOWN: Math.max(0, cov - 65) * 1.5 + Math.max(0, spd - 65) * 0.5,
    BALL_HAWK:Math.max(0, awr - 55) * 1.3 + Math.max(0, agi - 60) * 0.6,
    PHYSICAL: Math.max(0, str - 50) * 1.6 + (spd < 75 ? 4 : 0),
    SLOT_CB:  Math.max(0, agi - 65) * 1.4 + Math.max(0, spd - 60) * 0.4,
    ZONE:     Math.max(0, awr - 60) * 1.4,
  };
  for (const k in w) w[k] += Math.random() * 6;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
function pickSArchetype(stats) {
  const [spd, str, _agi, awr, _thr, _cat, _blk, _prs, cov, tck] = stats;
  const w = {
    BALL_HAWK:    Math.max(0, awr - 60) * 1.4 + Math.max(0, cov - 60) * 0.5,
    BOX:          Math.max(0, tck - 60) * 1.5,
    CENTER_FIELD: Math.max(0, spd - 60) * 1.3 + Math.max(0, cov - 60) * 0.5,
    // Headhunter: Sean Taylor / Kam Chancellor — STR + TCK + SPD profile.
    // Slightly more permissive than LB version (safeties hit a smaller pool).
    HEADHUNTER:   (str >= 72 && tck >= 72 && spd >= 75)
                  ? Math.max(0, str - 65) * 1.0 + Math.max(0, tck - 65) * 0.9 + Math.max(0, spd - 70) * 0.5
                  : 0,
    // Plays single-high OR in the box equally — rewards balanced coverage +
    // tackling so a well-rounded safety lands HYBRID at a real OVR.
    HYBRID:       10 + Math.max(0, Math.min(cov, tck) - 58) * 1.7,
  };
  for (const k in w) w[k] += Math.random() * 5;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}

// K archetypes — KPW (kpw=stats[10]) drives leg, AWR (stats[3]) drives accuracy
function pickKArchetype(stats) {
  const awr = stats[3], kpw = stats[10] ?? 70;
  const w = {
    LEG:       Math.max(0, kpw - 70) * 1.6 + (awr < 70 ? 3 : 0),
    PRECISION: Math.max(0, awr - 70) * 1.5 + (kpw < 75 ? 3 : 0),
    CLUTCH:    Math.max(0, awr - 65) * 0.8 + Math.max(0, kpw - 65) * 0.5,
    BALANCED:  6 + Math.max(0, ((kpw + awr) / 2) - 65),
  };
  for (const k in w) w[k] += Math.random() * 4;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}
// P archetypes — KPW = punt distance, AWR = directional / hang-time accuracy
function pickPArchetype(stats) {
  const spd = stats[0] ?? 60, agi = stats[2] ?? 60;
  const awr = stats[3], kpw = stats[10] ?? 70;
  const w = {
    BOOMER:      Math.max(0, kpw - 70) * 1.6 + (awr < 70 ? 2 : 0),
    DIRECTIONAL: Math.max(0, awr - 72) * 1.5 + (kpw < 72 ? 2 : 0),
    HANG_TIME:   Math.max(0, awr - 65) * 0.7 + Math.max(0, kpw - 60) * 0.6,
    ATHLETE:     Math.max(0, spd - 65) * 1.4 + Math.max(0, agi - 65) * 1.1 + Math.max(0, awr - 60) * 0.3,
    BALANCED:    6 + Math.max(0, ((kpw + awr) / 2) - 65),
  };
  for (const k in w) w[k] += Math.random() * 4;
  return Object.keys(w).reduce((a, b) => w[a] >= w[b] ? a : b);
}

// Pick a running style based on position + archetype — each player runs slightly differently.
// Detect rare strengths that don't fit a player's archetype. Pure flavor —
// stats stay as rolled, archetype label stays best-fit. The anomaly text is
// surfaced in the tooltip as e.g. "Thumper who can cover" or "Shutdown corner
// with hands". Returns an array of short strings (most players have 0-1).
function findArchetypeAnomalies(player) {
  const out = [];
  const s = player.stats;
  const SPD = s[0], STR = s[1], AGI = s[2], AWR = s[3];
  const CAT = s[5], PRS = s[7], COV = s[8], TCK = s[9];
  const arch = player.archetype;
  const pos = player.position;
  const ELITE = 88;     // threshold for "anomalous strength"
  const ELITE2 = 92;    // headline anomaly
  if (pos === "LB") {
    if (arch === "THUMPER" && COV >= ELITE)   out.push("Thumper who can cover");
    if (arch === "THUMPER" && SPD >= ELITE)   out.push("Sideline-to-sideline thumper");
    if (arch === "BLITZER" && COV >= ELITE)   out.push("Blitzer with coverage chops");
    if (arch === "COVER"   && STR >= ELITE)   out.push("Coverage LB who packs a punch");
    if (arch === "SIGNAL"  && PRS >= ELITE)   out.push("Signal-caller with sneaky pass-rush juice");
    if (arch === "HYBRID"  && AWR >= ELITE2)  out.push("Hybrid with rare instincts");
  }
  if (pos === "CB") {
    if (arch === "PHYSICAL" && SPD >= ELITE)  out.push("Physical corner who can flat-out RUN");
    if (arch === "SHUTDOWN" && STR >= ELITE)  out.push("Shutdown corner who'll lay you out");
    if (arch === "SLOT_CB"  && STR >= ELITE)  out.push("Slot corner who's not afraid of contact");
    if (arch === "ZONE"     && AGI >= ELITE)  out.push("Zone corner with man-cover quicks");
    if (arch === "BALL_HAWK"&& COV >= ELITE2) out.push("Ball hawk who locks down too");
  }
  if (pos === "S") {
    if (arch === "BOX"          && COV >= ELITE)  out.push("Box safety who covers like a corner");
    if (arch === "CENTER_FIELD" && STR >= ELITE)  out.push("Center fielder who'll bring the wood");
    if (arch === "BALL_HAWK"    && TCK >= ELITE)  out.push("Ball hawk who tackles in the box");
    if (arch === "HYBRID"       && SPD >= ELITE2) out.push("Hybrid safety with rare range");
  }
  if (pos === "DL") {
    if (arch === "POWER"      && SPD >= ELITE)  out.push("Power rusher with sneaky speed");
    if (arch === "SPEED"      && STR >= ELITE)  out.push("Speed rusher who can also bull");
    if (arch === "PENETRATOR" && COV >= 75)     out.push("Interior who drops into coverage");
    if (arch === "TECHNICIAN" && PRS >= ELITE2) out.push("Technician with elite pass-rush production");
  }
  if (pos === "OL") {
    if (arch === "MAULER"   && AGI >= ELITE) out.push("Mauler with light feet");
    if (arch === "ATHLETIC" && STR >= ELITE) out.push("Athletic OL who can also road-grade");
    if (arch === "PLUG"     && SPD >= 75)    out.push("Plug who pulls like a guard");
  }
  if (pos === "RB") {
    if (arch === "POWER"     && SPD >= ELITE) out.push("Power back with breakaway speed");
    if (arch === "ELUSIVE"   && STR >= ELITE) out.push("Elusive back who runs through tackles");
    if (arch === "WORKHORSE" && CAT >= ELITE) out.push("Workhorse who catches everything");
    if (arch === "RECEIVING" && STR >= ELITE) out.push("Receiving back who breaks tackles");
  }
  if (pos === "WR") {
    if (arch === "DEEP"        && CAT >= ELITE2) out.push("Deep threat with reliable hands");
    if (arch === "POSSESSION"  && SPD >= ELITE)  out.push("Possession WR with deep speed");
    if (arch === "ROUTE_RUNNER"&& STR >= ELITE)  out.push("Route runner with contested-catch frame");
    if (arch === "SLOT"        && STR >= ELITE)  out.push("Slot receiver with linebacker frame");
    if (arch === "RED_ZONE"    && SPD >= ELITE)  out.push("Red-zone WR who can take the top off");
  }
  if (pos === "TE") {
    if (arch === "BLOCKING"  && CAT >= ELITE2) out.push("Blocking TE with hands");
    if (arch === "RECEIVING" && STR >= ELITE)  out.push("Receiving TE who blocks the edge");
    if (arch === "SEAM"      && STR >= ELITE)  out.push("Seam TE who can in-line block");
  }
  if (pos === "QB") {
    if (arch === "POCKET"      && SPD >= ELITE)  out.push("Pocket passer with surprising legs");
    if (arch === "DUAL_THREAT" && AWR >= ELITE2) out.push("Dual-threat with field-general reads");
    if (arch === "GUNSLINGER"  && AWR >= ELITE)  out.push("Gunslinger with rare poise");
    if (arch === "GAME_MANAGER"&& s[4] >= ELITE2) out.push("Game manager with a cannon");
  }
  return out.length ? out : null;
}

function pickRunStyle(pos, archetype) {
  if (pos === "QB") return archetype === "DUAL_THREAT" ? "scrambler" : "smooth";
  if (pos === "RB") {
    if (archetype === "POWER")  return "powerful";
    if (archetype === "SPEED")  return "loping";
    if (archetype === "ELUSIVE")return "short";
    return "smooth";
  }
  if (pos === "WR") {
    if (archetype === "DEEP_THREAT") return "loping";
    if (archetype === "SLOT")        return "short";
    return "glider";
  }
  if (pos === "TE") return archetype === "BLOCKING" ? "plodding" : "powerful";
  if (pos === "OL") return "plodding";
  if (pos === "DL") {
    if (archetype === "SPEED")   return "loping";
    if (archetype === "POWER")   return "powerful";
    if (archetype === "TWEENER") return "short";
    return "plodding";
  }
  if (pos === "LB") return archetype === "THUMPER" ? "powerful" : "smooth";
  if (pos === "CB") {
    if (archetype === "SHUTDOWN") return "loping";
    if (archetype === "SLOT_CB")  return "short";
    return "smooth";
  }
  if (pos === "S")  return archetype === "CENTER_FIELD" ? "loping" : "smooth";
  return "smooth";
}
function pickCelebStyle() {
  return CELEB_STYLES[Math.floor(Math.random() * CELEB_STYLES.length)];
}

// Position-realistic height (inches) + weight (lbs). bodyType nudges the
// roll: PLUS_SIZE skews heavier, SLENDER skews lighter.
const HW_RANGES = {
  QB: { h: [74, 78], w: [210, 240] },
  RB: { h: [68, 73], w: [195, 235] },
  WR: { h: [70, 76], w: [180, 220] },
  TE: { h: [75, 79], w: [240, 265] },
  OL: { h: [75, 79], w: [295, 345] },
  DL: { h: [74, 79], w: [265, 320] },
  LB: { h: [72, 76], w: [225, 260] },
  CB: { h: [70, 74], w: [180, 200] },
  S:  { h: [71, 75], w: [195, 215] },
  K:  { h: [70, 75], w: [185, 215] },
  P:  { h: [72, 76], w: [195, 220] },
};
function assignHeightWeight(p) {
  const r = HW_RANGES[p.position] || HW_RANGES.WR;
  let height = r.h[0] + Math.floor(Math.random() * (r.h[1] - r.h[0] + 1));
  let weight = r.w[0] + Math.floor(Math.random() * (r.w[1] - r.w[0] + 1));
  if (p.bodyType === "PLUS_SIZE") { height += 1; weight += 18; }
  else if (p.bodyType === "SLENDER") { weight -= 10; }
  p.height = height;
  p.weight = weight;
}
function formatHeight(inches) {
  if (!inches) return "";
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

function genPlayer(pos, tier) {
  const stats = statsFor(pos, tier);
  // Bad-tier players get a flavor: physical freak who can't read defenses,
  // or smart vet whose body is shot. Skip flavor for K/P/special teams.
  let flavor = null;
  if ((tier === "poor" || tier === "average") && pos !== "K" && pos !== "P") {
    flavor = applyFlavor(stats, pos);
    // RAW_ATHLETE flavor pushes SPD to 68-80 unconditionally, which
    // violates the OL/DL/etc. position SPD ceilings applied in statsFor.
    // Re-cap after the flavor pass so an "athletic OL" doesn't end up
    // running a 4.40 40-yd.
    _applyPositionCaps(pos, stats);
  }
  // Build the legal name: first + (optional middle) + last. The display name
  // (what shows up in play logs, tooltips, and on the field) might be the
  // initials version ("T.J. Watt"), the middle name ("Cooper Smith"), or
  // just first+last, depending on how the player "goes by".
  const firstName = pickFirstName();
  const lastName  = pickLastName();
  const middleName = Math.random() < 0.55 ? pickFirstName() : null;
  let displayName = `${firstName} ${lastName}`;
  if (middleName && !middleName.includes("'") && !firstName.includes("'")
      && !middleName.includes("-") && !firstName.includes("-")) {
    const roll = Math.random();
    if (roll < 0.07) {
      // Initials style: "T.J. Watt" (real NFL: T.J. Watt, A.J. Brown, C.J. Stroud)
      displayName = `${firstName[0]}.${middleName[0]}. ${lastName}`;
    } else if (roll < 0.11) {
      // Goes by middle name: drops the first entirely
      displayName = `${middleName} ${lastName}`;
    } else if (roll < 0.13) {
      // First + middle initial: "Patrick L. Mahomes"
      displayName = `${firstName} ${middleName[0]}. ${lastName}`;
    }
  }
  const player = {
    pid: Math.random().toString(36).slice(2, 10),
    name: displayName,
    firstName, middleName, lastName,
    position: pos,
    age: rand(21, 33),
    stats,
    overall: calcOverall(pos, stats),
    flavor,
    _genTier: tier,   // read by the tier-aware TEC scaling below
  };
  // Rare durability trait (~3%) — halves per-game injury rate. Brett Favre /
  // Eli Manning / Cal Ripken style. Mostly invisible mechanic; shows as a
  // small flag on the owned-player card.
  if (Math.random() < 0.03) player.ironman = true;

  // Personality archetype — drives subtle locker-room dynamics. Most
  // players are "normal" (no flag); the rest fall into 5 archetypes that
  // affect dev rates, team chemistry, and longevity.
  //   captain    8%  : +5% dev to young teammates around them
  //   cancer     2%  : −5% team chemistry, drains dev for the whole roster
  //   quiet_pro 12%  : both slower growth AND slower decline (longer prime)
  //   showman    8%  : flavor-only for now (playoff scaling not modeled)
  //   coachs_son 4%  : extra TEC growth, max coachability
  //   normal    66%  : no special trait
  const pr = Math.random();
  if      (pr < 0.08) player.personality = "captain";
  else if (pr < 0.10) player.personality = "cancer";
  else if (pr < 0.22) player.personality = "quiet_pro";
  else if (pr < 0.30) player.personality = "showman";
  else if (pr < 0.34) player.personality = "coachs_son";
  switch (pos) {
    case "QB": player.archetype = pickQBArchetype(stats); break;
    case "DL": player.archetype = pickDLArchetype(stats); break;
    case "OL": player.archetype = pickOLArchetype(stats); break;
    case "RB": player.archetype = pickRBArchetype(stats); break;
    case "WR": player.archetype = pickWRArchetype(stats); break;
    case "TE": player.archetype = pickTEArchetype(stats); break;
    case "LB": player.archetype = pickLBArchetype(stats); break;
    case "CB": player.archetype = pickCBArchetype(stats); break;
    case "S":  player.archetype = pickSArchetype(stats);  break;
    case "K":  player.archetype = pickKArchetype(stats);  break;
    case "P":  player.archetype = pickPArchetype(stats);  break;
  }
  // TEC by archetype — only applied when no flavor overrode it (null flavor = ~10% of players).
  // Flavor already set a meaningful TEC for RAW_ATHLETE / HIGH_FOOTBALL_IQ players.
  if (!flavor) {
    const arch = player.archetype;
    const tec = {
      // QB
      FIELD_GENERAL:72, GAME_MANAGER:74, POCKET:68, GUNSLINGER:58, DUAL_THREAT:57,
      // OL
      TECHNICIAN:80, ANCHOR:72, MAULER:60, ATHLETIC:65, PLUG:65,
      // DL
      POWER:61, SPEED:65, TWEENER:70, PENETRATOR:67,
      // LB
      COVER:72, THUMPER:60, BLITZER:65,
      // CB
      SHUTDOWN:74, PHYSICAL:66, SLOT_CB:76, ZONE:67,
      // S
      CENTER_FIELD:70, BOX:71, HYBRID:64,
      // WR
      ROUTE_RUNNER:80, POSSESSION:72, SLOT:73, RED_ZONE:60,
      // RB
      WORKHORSE:72, RECEIVING:70, ELUSIVE:70,
      // TE
      BLOCKING:76, SEAM:66,
    }[arch];
    if (tec != null) {
      player.stats[11] = rand(tec - 5, tec + 5);
    } else {
      player.stats[11] = rand(62, 72); // fallback
    }
    // Tier-aware TEC scaling. TEC contributes 15% of EVERY position's OVR, but
    // the archetype TEC table tops out at 80 (TECHNICIAN/ROUTE_RUNNER) and most
    // sit at 65-72 — which structurally caps every elite-tier player's OVR
    // around 87-90 even when their primary stats are 95+. NFL superstars (Brady,
    // Donald, Rice) all have elite technique alongside elite physical/skill
    // ratings, so an "elite" tier player needs an elite TEC range too. Bumps
    // are applied only when the tier tag was passed (set on genUniquePlayer's
    // path); otherwise unchanged.
    const _genTier = player._genTier;
    if (_genTier === "elite")        player.stats[11] = rand(85, 99);   // gives 99-tier headroom
    else if (_genTier === "good")    player.stats[11] = Math.max(player.stats[11], rand(70, 82));
  }
  // AWR ceiling — how high this player's awareness can grow from game reps.
  // Sealed at creation so it's stable across loads. HIGH_IQ players are already
  // near their ceiling; RAW_ATHLETEs have a hard cap on how smart they can get.
  player._awrCeiling = flavor === "HIGH_FOOTBALL_IQ" ? rand(82, 95)
                     : flavor === "RAW_ATHLETE"       ? rand(55, 72)
                     : rand(65, 82);
  player.coachable = Math.random() < (flavor === "HIGH_FOOTBALL_IQ" ? 0.45 : flavor === "RAW_ATHLETE" ? 0.10 : 0.25);
  // Stamina — how many snaps a player can handle before fatigue degrades performance.
  // RAW_ATHLETE: high stamina (physical engine), HIGH_IQ: lower (cerebral, needs rotation).
  player._stamina = flavor === "RAW_ATHLETE"      ? rand(82, 95)
                  : flavor === "HIGH_FOOTBALL_IQ" ? rand(50, 68)
                  : rand(68, 82);
  // Physical peak ages — onset is when decline begins; pre-peak players can still gain.
  // RAW_ATHLETE peaks explosively early and falls faster; HIGH_IQ ages gracefully.
  if (flavor === "RAW_ATHLETE") {
    player._physicalPeak = { spd:{peak:23,onset:26}, agi:{peak:24,onset:27}, str:{peak:26,onset:29} };
  } else if (flavor === "HIGH_FOOTBALL_IQ") {
    player._physicalPeak = { spd:{peak:27,onset:30}, agi:{peak:28,onset:31}, str:{peak:29,onset:33} };
  } else {
    player._physicalPeak = { spd:{peak:25,onset:28}, agi:{peak:26,onset:29}, str:{peak:28,onset:31} };
  }
  // Recalculate overall now that TEC is set properly.
  player.overall = calcOverall(pos, player.stats);

  // Tag any "anomaly" — a rare strength outside what the archetype typically
  // implies (e.g. a Thumper LB who can also cover). Surfaced in the tooltip
  // as a fun-fact. Doesn't change the stats; the archetype label is still the
  // best-fit summary.
  player.anomalies = findArchetypeAnomalies(player);
  player.runStyle = pickRunStyle(pos, player.archetype);
  player.celebStyle = pickCelebStyle();
  player.bodyType = pickBodyType(pos, player.archetype);
  player.nickname = null;
  // Height (inches) + weight (lbs) drawn from position-realistic ranges,
  // nudged by bodyType so PLUS_SIZE / SLENDER read on the profile.
  assignHeightWeight(player);
  // College jersey number — the digit they wore in college and would prefer
  // to keep. Final pro number assigned at the team level (see
  // assignTeamJerseyNumbers) which resolves conflicts.
  assignCollegeNumber(player);
  // COLLEGE NICKNAME — young (≤23), highly-rated players have a 30% chance of
  // arriving with a nickname earned in college (record-breakers, elite
  // prospects). They keep it through their career; pro top-10 status won't
  // overwrite it. Tagged player.collegeNickname=true so the tooltip can
  // surface "earned in college".
  if (player.age <= 23 && player.overall >= 86 && pos !== "K" && pos !== "P"
      && Math.random() < 0.30) {
    const nick = pickCareerNickname(player);
    if (nick) {
      player.nickname = nick;
      player.collegeNickname = true;
    }
  }
  // Hidden mental + injury traits. Loosely correlated with potential (high
  // potential ≠ high drive — that's what creates busts vs overachievers).
  // Server-side in MegaETH port; client only sees scout-tag derivations.
  if (player._drive == null) {
    const driveRoll = Math.random();
    // Mean ~60, sd ~18, clamped 20-99.
    player._drive = Math.max(20, Math.min(99, Math.round(60 + (driveRoll * 2 - 1) * 35 + (Math.random() - 0.5) * 10)));
  }
  if (player._durability == null) {
    const durRoll = Math.random();
    player._durability = Math.max(25, Math.min(99, Math.round(65 + (durRoll * 2 - 1) * 30)));
  }
  if (player._clutch == null) {
    // Hidden composure under pressure — a TWO-TAILED trait (1-99, 50 = neutral,
    // i.e. no situational modifier). Deliberately skewed so the CHOKE tail is
    // heavier/deeper than the clutch tail: pressure-degradation is the
    // better-supported real effect than pressure-elevation. The rare ice-veins
    // (~80+) and folders (~<25) are the tails; most players sit near neutral.
    // Bell-ish via a 3-roll average, then an asymmetric stretch (choke side
    // widened) and a little jitter.
    const cRoll = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;   // ~bell around 0, [-0.5,+0.5]
    const dev = cRoll >= 0 ? cRoll * 84 : cRoll * 102;                          // negative (choke) side stretched further
    player._clutch = Math.max(1, Math.min(99, Math.round(50 + dev + (Math.random() - 0.5) * 6)));
    // The visible kicker CLUTCH archetype IS "clutch by reputation" — generate
    // it on the high end so the trait keeps meaning what it always has (the
    // engine's old binary archetype FG bonus is now driven by this attribute).
    if (player.archetype === "CLUTCH") {
      player._clutch = Math.max(player._clutch, 72 + Math.floor(Math.random() * 20));   // 72-91
    }
  }
  // Mock the player's career (year-by-year stats + accolades) at gen time
  generateCareer(player);
  return player;
}

// ─── MOCK CAREER GENERATION ─────────────────────────────────────────────────

// Assign a hidden gem flag to a newly-created draft pick or UDFA.
// Called immediately after draftRound is stamped on the player.
// Rates are grounded in NFL history: ~1 UDFA star per 4-5 classes league-wide,
// Raise a high-ceiling gem's FROZEN physical stats just enough that maxing the
// developable stats reaches the ceiling OVR — fixes the "99 wall" where a
// single-number ceiling is unreachable because pedestrian physicals cap the
// multi-stat OVR. Works off calcOverall directly (formula-agnostic). Only raises.
// FROZEN = physical stats in each position's OVR formula NOT in _gemDevStats
// (the coachable core). K/P excluded by caller (all their stats are developable).
const _GEM_FROZEN_PHYS = {
  QB:[0,2,4],   // spd, agi, thr
  RB:[0,1,2],   // spd, str, agi
  WR:[0,2],     // spd, agi
  TE:[0,1],     // spd, str
  OL:[1,2],     // str, agi
  DL:[0,1],     // spd, str
  LB:[0],       // spd
  CB:[0,2],     // spd, agi
  S:[0],        // spd
};
const _GEM_DEV_IDX = {
  QB:[3,11], RB:[5,11], WR:[5,3,11], TE:[5,6,11], OL:[6,11],
  DL:[7,11], LB:[9,8,7,11], CB:[8,3,11], S:[8,9,3,11],
};
// Marginal OVR weight (≈0-40) of a stat for a position, derived from calcOverall
// by finite difference so it stays in sync if the weight tables ever change.
function _statWeightPct(pos, idx) {
  if (typeof calcOverall !== "function") return 0;
  const base = new Array(12).fill(50);
  const bumped = base.slice(); bumped[idx] = 90;            // +40 to beat rounding
  return (calcOverall(pos, bumped) - calcOverall(pos, base)) * 2.5;
}
// Realistic (not perfect) development target for a coachable stat. Real growth
// chases overall, so it prioritizes high-weight stats toward max while neglecting
// low-weight dev stats (e.g. a WR's 8%-weight awareness) which realistically lag
// several points short. The physical floor is solved against THIS outcome instead
// of a fictional all-99 dev, giving high-frozen-weight skill positions (WR/TE) the
// measurable headroom to actually reach their ceiling under imperfect growth —
// without over-provisioning QB/OL/DL whose dev is high-weight or few-stat.
function _realisticDevTarget(pos, idx) {
  const w = _statWeightPct(pos, idx);
  if (w >= 25) return 97;   // prioritized core stat → near-max
  if (w >= 15) return 95;   // secondary dev stat → strong
  return 93;                // low-weight, development-neglected → lags
}
function _gemPhysicalFloor(player, ceiling, rng) {
  const pos = player.position;
  const frozen = _GEM_FROZEN_PHYS[pos], dev = _GEM_DEV_IDX[pos];
  if (!frozen || !dev || typeof calcOverall !== "function") return;
  // Target ceiling minus a small slack so 96-ceiling gems don't ALL need 99
  // physicals (slack lets the rare ones land 96-97 with strong-but-not-max gifts).
  const target = ceiling;
  // Probe: developable stats set to their REALISTIC (not all-99) outcome; raise
  // frozen (lowest-first) until OVR reaches the ceiling or frozen caps at 99.
  const probe = player.stats.slice();
  for (const i of dev) probe[i] = _realisticDevTarget(pos, i);
  let guard = 0;
  while (calcOverall(pos, probe) < target && guard++ < 200) {
    const order = frozen.slice().sort((a, b) => probe[a] - probe[b]);
    let raised = false;
    for (const i of order) { if (probe[i] < 99) { probe[i]++; raised = true; break; } }
    if (!raised) break;
  }
  // Apply discovered frozen floors to the REAL stats (only raise). For the very
  // top ceilings (97+) use the exact floor so 99 is cleanly reachable; below that
  // allow 0-2 of slack so elite gems don't all have identical measurables.
  const slack = ceiling >= 97 ? 0 : 2;
  for (const i of frozen) {
    const floor = Math.max(40, probe[i] - (slack && rng ? Math.floor(rng() * (slack + 1)) : 0));
    if ((player.stats[i] ?? 0) < floor) player.stats[i] = floor;
  }
}
// ~5-6% of rounds 5-7 produce pro-bowl caliber players over time.
// The gem is fully invisible — no scout grade tell, no combine signal.
function _rollHiddenGem(player) {
  // K/P excluded entirely. The Brady audit revealed 50% of "legend" emergences
  // (4 in 40 yrs → 2 punters!) were kickers/punters: AWR weighs 42% of K/P OVR
  // in calcOverall AND grows in-season AND K/P don't physically decline, so any
  // K/P gem deterministically rides to OVR 99 and stays there for a decade.
  // Real NFL kickers cap around ~90 OVR; a late-round-kicker Brady story isn't
  // the design intent. Non-gem K/P still develop normally up to their
  // potential ceiling (typically 65-75), which is realistic.
  if (player.position === "K" || player.position === "P") return;
  // Inverted rate curve: UDFAs / late-rounders are the most likely hidden
  // gems (pure flyers, no scouting consensus to "hide" against). Early
  // rounds are heavily scouted so there's less room for surprise.
  // Path A dampening: rates cut ~3× from earlier values. Old rates
  // produced ~7-8 gems per draft; NFL has 1-3. New rates target ~2-3
  // gems per draft with ~1 elite-ceiling emergence per draft.
  // No position multiplier on rate — Brady wasn't "more likely to be
  // a gem than other R6 picks." His remarkable trait was that the gem
  // ceiling was HOF-tier. That's modeled in the ceiling skew below.
  // R5 0.015 → 0.018 to smooth the R5→R6 transition. Audit showed R5 produced
  // fewer 90+% (0.8%) than R6 (1.3%) because the gem rate jumped 47% from R5
  // to R6. NFL pattern has some late-round gems in R5 too (Kam Chancellor,
  // Devonta Freeman), so a modest bump keeps the curve smooth and reduces the
  // R5 bust rate. R6 remains distinctly the "Brady tier" — the gap is still real.
  const rates = { 0: 0.045, 7: 0.028, 6: 0.022, 5: 0.018, 4: 0.008, 3: 0.004 };
  const rate = rates[player.draftRound] ?? 0;
  // Deterministic seed: a prospect's gem destiny is fixed at class
  // generation, just revealed when drafted. Same player gets the same
  // roll regardless of which team picks them and regardless of how
  // many times the class is rebuilt (crash-before-save, MegaETH replay).
  // Falls back to Math.random for legacy / non-class players that lack
  // the name+year identifier (e.g., the assignDraftInfo backfill).
  const seed = (player.name && player.draftYear)
    ? `${player.name}|${player.draftYear}|gem`
    : null;
  const rng = seed
    ? (() => { let n = 0; return () => _seededRand(seed, n++); })()
    : Math.random;
  if (!rate || rng() >= rate) return;
  // Ceiling distribution: most gems are solid starters (78-89), some are
  // Pro Bowlers (90-95), a tail lands in the extreme HOF range (96-99).
  //
  // QB-specific skew: when a QB gem fires, the ceiling distribution is
  // dramatically more top-heavy. Real NFL Brady-tier QBs (Brady, Wilson,
  // Romo, Dak) weren't more frequent than other late-round emergences
  // — they had transformative ceilings when they emerged. Same gem
  // RATE as other positions; the QB "wow moment" comes from ceiling.
  //
  // QB:    30% 77-88 (common) / 40% 90-95 (mid) / 30% 96-99 (HOF tier)
  // Other: 78% 78-89        /  14% 90-95       /  8% 96-99
  const r = rng();
  const isQB = player.position === "QB";
  let ceiling;
  // QB gem ceiling — unimodal, peaked at the Pro Bowl mid tier with symmetric
  // tails. Design statement: "a QB hidden gem is scouts-missed Pro Bowl talent,
  // with symmetric uncertainty about whether they top out short of stardom or
  // push into the HOF range." Distinct shape from non-QB gems (which are
  // monotone-decreasing 78/14/8 — most are modest surprises, rare stars) because
  // QB outcome variance is genuinely wider than other positions in the league.
  //
  // Numerology history: original 40/35/25 → 35/15/50 (HOF doubled to fix "0
  // True Brady" complaint, paired with the gem REALIZATION WALL fix) → measured
  // at 11.38 True Brady/100yr with 95% CI [9.04, 13.71] across a 4x200-season
  // audit (800 season-equiv), sitting on the 2-12 band ceiling so ~44% of audits
  // would flag it → 40/20/40 (rate-only trim, but the bimodal 'backup-or-HOF,
  // rarely Pro Bowler' shape didn't tell a coherent story) → CURRENT 30/40/30,
  // which IS explainable AND lands True Brady at ~8-9/100yr (flag rate ~16%,
  // comfortably mid-band). Tune ONLY against an aggregated multi-run mean (the
  // audit metric is unseeded → each run is one independent draw); never noise-
  // fit on a single 100-season audit.
  if (isQB) {
    if (r < 0.30)      ceiling = 77 + Math.floor(rng() * 12); // 77-88 common (30%)
    else if (r < 0.70) ceiling = 90 + Math.floor(rng() * 6);  // 90-95 mid    (40%)
    else               ceiling = 96 + Math.floor(rng() * 4);  // 96-99 HOF    (30%)
  } else {
    // Mid (90-95) tier trimmed 14%→8%: a 100-season audit showed 146 R6+/UDFA
    // players reaching 90+ (target ~60-100) — bottom-heavy, the 90-94 band ~6× the
    // 95+ band vs the intended ~3×. The over-population was mid-ceiling gems (most
    // reach 90+ easily). Trimming mid pulls the 90+ total toward ~90 while leaving
    // the 96+ EXTREME tier (8%) — which feeds the 95+/99 tail — untouched.
    if (r < 0.84)      ceiling = 77 + Math.floor(rng() * 12); // 77-88 common (84%)
    else if (r < 0.92) ceiling = 90 + Math.floor(rng() * 6);  // 90-95 mid (8%)
    else               ceiling = 96 + Math.floor(rng() * 4);  // 96-99 extreme (8%)
  }
  player.hiddenGem = {
    ceiling,
    growthRate: 4 + Math.floor(rng() * 5),
  };
  // GEM PHYSICAL BASELINE (all positions). A gem's "ceiling" is a single number,
  // but OVR is a weighted sum of many stats — and the FROZEN physical stats (out
  // of the dev pools) cap what's achievable. A high-ceiling gem with pedestrian
  // physicals can't REACH his ceiling no matter how much he develops the coachable
  // stats — the "99 wall" (0% of 96-99 ceiling gems reached 99; True Brady was 0).
  // So for an elite-ceiling gem, raise the frozen physicals just enough that maxing
  // the developable stats realizes the ceiling. This is the rare "scouts whiffed on
  // a complete player who fell for off-field/measurement reasons" case (Brady,
  // Wilson, Romo, UDFA freaks). Solved off calcOverall directly so it tracks any
  // formula. Only RAISES sub-floor stats.
  if (player.stats && ceiling >= 90 && player.position !== "K" && player.position !== "P") {
    _gemPhysicalFloor(player, ceiling, rng);
    if (typeof calcOverall === "function") player.overall = calcOverall(player.position, player.stats);
  }
  // Propagate the gem ceiling into p.potential so the drafting team's perceived
  // upside (via _perceivedPotential / cutValue) reflects the practice-insight
  // revelation. Without this, R6 gems with true ceiling 99 looked like 65-
  // ceiling fringe players to their own team and got cut before they could
  // develop. NFL parallel: a team's own practice tape reveals upside that
  // public scouting consensus missed.
  if ((player.potential || 0) < ceiling) {
    player.potential = ceiling;
  }
  // ALSO re-roll p._growthRate to match the gem ceiling. The college pipeline
  // sets _growthRate based on the ORIGINAL (low) oracle potential, so a R8 gem
  // with HOF-tier ceiling inherits the slow-developer growth distribution of a
  // 65-ceiling player. Diagnostic showed ceiling-96+ gems peaking at 71-87 even
  // after p.potential propagation — the slow rate was the residual bottleneck.
  // Re-roll using the new ceiling so a 99-ceiling gem gets 30%/55%/15% (0.90/
  // 0.65/0.35), matching what a known 99-ceiling prospect would draw.
  if (typeof _seededRand === "function") {
    const growKey = `gem-grow|${player.name}|${player.draftYear || 0}`;
    const growRoll = _seededRand(growKey);
    let newRate;
    if (ceiling >= 80) newRate = growRoll < 0.30 ? 0.90 : growRoll < 0.85 ? 0.65 : 0.35;
    else if (ceiling >= 65) newRate = growRoll < 0.20 ? 0.90 : growRoll < 0.75 ? 0.65 : 0.35;
    else newRate = growRoll < 0.08 ? 0.90 : growRoll < 0.45 ? 0.65 : 0.35;
    // Only upgrade — never downgrade an already-fast rate.
    if (!player._growthRate || newRate > player._growthRate) {
      player._growthRate = newRate;
    }
  }
}
// Fabricates a believable multi-season career for each player based on their
// age + overall rating + position. Used to populate the profile-page hover.
function generateCareer(player) {
  if (!player || !player.position) return;
  const age = player.age || 24;
  const seasonsPlayed = Math.max(0, age - 22);
  if (seasonsPlayed === 0) {
    player.career = [];
    player.careerTotals = {};
    player.careerHistory = [];
    player.careerStats = {};
    player.proBowls = 0; player.allPros = 0; player.sbRings = 0;
    player.mvps = 0; player.opoys = 0; player.dpoys = 0; player.roys = 0;
    player.records = [];
    return;
  }
  const currentYear = 2026;
  const ovr = player.overall || 70;
  const pos = player.position;

  // ── Trajectory type ─────────────────────────────────────────────────────
  // Deterministic from name hash so career arc is stable across reloads.
  let nameHash = 0;
  for (const c of (player.name || "")) nameHash = (nameHash * 31 + c.charCodeAt(0)) | 0;
  const nh = Math.abs(nameHash);

  // Elite players skew toward early bloom / consistency.
  // Average players skew toward late bloom / streaky.
  let trajectory;
  if (ovr >= 88) {
    const t = nh % 10;
    trajectory = t < 4 ? "EARLY_BLOOM" : t < 7 ? "CONSISTENT" : t < 9 ? "LATE_BLOOM" : "STREAKY";
  } else if (ovr >= 78) {
    const t = nh % 10;
    trajectory = t < 2 ? "EARLY_BLOOM" : t < 5 ? "CONSISTENT" : t < 8 ? "LATE_BLOOM" : "STREAKY";
  } else if (ovr >= 68) {
    const t = nh % 10;
    trajectory = t < 1 ? "EARLY_BLOOM" : t < 3 ? "CONSISTENT" : t < 6 ? "LATE_BLOOM" : t < 9 ? "STREAKY" : "FLASH";
  } else {
    const t = nh % 10;
    trajectory = t < 2 ? "CONSISTENT" : t < 5 ? "LATE_BLOOM" : t < 8 ? "STREAKY" : "FLASH";
  }

  // Peak age and shape params.
  // rampYears: seasons from age-22 to reach peak (shorter = faster rise)
  // postPeakDrop: fraction of effOvr lost per year after peak
  // Higher OVR → faster ramp, slower decline (elite players are further ahead earlier)
  const ovrT = Math.max(0, Math.min(1, (ovr - 60) / 39)); // 0 at OVR60, 1 at OVR99
  const TRAJ = {
    EARLY_BLOOM: { peakAge: 24, rampYears: 2,  postPeakDrop: 0.018 - ovrT * 0.006 },
    CONSISTENT:  { peakAge: 26, rampYears: 4,  postPeakDrop: 0.022 - ovrT * 0.006 },
    LATE_BLOOM:  { peakAge: 28, rampYears: 6,  postPeakDrop: 0.028 - ovrT * 0.007 },
    STREAKY:     { peakAge: 25, rampYears: 3,  postPeakDrop: 0.035 - ovrT * 0.008 },
    FLASH:       { peakAge: 23, rampYears: 1,  postPeakDrop: 0.055 - ovrT * 0.010 },
  };
  const { peakAge, rampYears, postPeakDrop } = TRAJ[trajectory];

  // Seeded LCG for per-season events — same career arc every time called.
  let seed = nh ^ (ovr * 1234567);
  const rng = () => {
    seed = (Math.imul(seed | 0, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };

  const career = [];
  const history = [];
  const totals  = {};
  let bestSeasonOvr = 0;

  for (let i = 0; i < seasonsPlayed; i++) {
    const seasonYear = currentYear - seasonsPlayed + i;
    const seasonAge  = 22 + i;

    // ── Base trajectory factor ─────────────────────────────────────────
    let baseFactor;
    if (seasonAge <= peakAge) {
      // Pre-peak: non-linear ramp using a power curve (accelerating rise)
      const t = rampYears > 0 ? Math.min(1, (seasonAge - 22) / rampYears) : 1;
      // Power 0.7 gives a concave-up curve: slow start, fast approach to peak
      // Elite players get a flatter (more linear) early career since they were
      // good right away. Less-elite players have a steeper approach.
      const power = 0.55 + ovrT * 0.35;  // 0.55 for avg, 0.90 for elite
      baseFactor = 0.68 + 0.32 * Math.pow(t, power);
    } else {
      // Post-peak: linear decline, slope tuned per trajectory and OVR
      const yearsPast = seasonAge - peakAge;
      baseFactor = 1.0 - yearsPast * postPeakDrop;
    }

    // ── Per-season events (seeded, so stable) ─────────────────────────
    let eventMod = 0;
    const roll = rng();
    if (i === 1 && rng() < 0.28) {
      // Sophomore slump — common enough to be realistic
      eventMod = -(0.05 + rng() * 0.08);
    } else if (roll < 0.06) {
      // Breakout / career-best season
      eventMod = 0.08 + rng() * 0.09;
    } else if (roll < 0.13) {
      // Injury / down year
      eventMod = -(0.11 + rng() * 0.11);
    } else if (roll < 0.22) {
      // Hot streak / contract year
      eventMod = 0.04 + rng() * 0.06;
    }
    // STREAKY careers get amplified swings
    if (trajectory === "STREAKY") eventMod *= 1.9;

    const totalFactor = Math.max(0.46, Math.min(1.12, baseFactor + eventMod));

    // Small gaussian-ish noise on top (±2 OVR)
    const microNoise = (rng() + rng() - 1.0) * 2;
    const effOvr = Math.round(Math.min(99, Math.max(44, ovr * totalFactor + microNoise)));
    if (effOvr > bestSeasonOvr) bestSeasonOvr = effOvr;

    const stats = mockSeasonStats(pos, effOvr, player.archetype);
    stats.year = seasonYear;
    stats.age  = seasonAge;
    stats.ovr  = effOvr;
    stats.accolades = generateAccolades(player, stats, effOvr, seasonAge);
    career.push(stats);

    const histRow = {
      season: seasonYear, year: seasonYear, age: seasonAge, ovr: effOvr,
      teamId: null, teamName: "—", pos,
    };
    for (const [k, v] of Object.entries(stats)) {
      if (typeof v === "number") {
        histRow[k] = v;
        totals[k] = (totals[k] || 0) + v;
      }
    }
    history.push(histRow);
  }
  player.career       = career;
  player.careerTotals = computeCareerTotals(career, pos);
  player.careerHistory = history;
  player.careerStats   = totals;
  player._trajectory   = trajectory;   // visible on player card for flavor
  const all = career.flatMap(s => s.accolades || []);
  player.proBowls = all.filter(a => a === "Pro Bowl").length;
  player.allPros  = all.filter(a => a === "All-Pro").length;
  player.sbRings  = all.filter(a => a === "Super Bowl").length;
  player.mvps     = all.filter(a => a === "MVP").length;
  player.opoys    = all.filter(a => a === "OPOY").length;
  player.dpoys    = all.filter(a => a === "DPOY").length;
  player.roys     = all.filter(a => a === "ROY").length;
  player.records  = generateRecords(player, career, bestSeasonOvr);
}

// Stamp realistic team names onto each player's past-season history rows.
// Career travel probability scales with career length. Multiple prior teams
// possible for veterans. All choices are deterministic from name+teamId hash.
function assignCareerTeams(rosters) {
  for (const [teamIdStr, roster] of Object.entries(rosters || {})) {
    const teamId = Number(teamIdStr);
    const team = getTeam(teamId);
    if (!team) continue;
    const teamName = `${team.city} ${team.name}`;

    for (const p of roster) {
      const hist = p.careerHistory || [];
      const n = hist.length;
      if (!n) continue;
      // Idempotency: once career-team names are stamped (either by this
      // function or by _assignFACareerTeams), leave them alone. Otherwise
      // FAs who get signed have their history rewritten on every dashboard
      // render — appearing to have spent their entire career with you.
      if (p._careerTeamsAssigned) continue;
      const firstStamped = hist[0]?.teamName && hist[0].teamName !== "—";
      if (firstStamped) { p._careerTeamsAssigned = true; continue; }

      // Seeded LCG — stable across reloads. Mix name, pid and teamId.
      let seed = 0;
      for (const c of (p.pid || p.name || "")) seed = (seed * 31 + c.charCodeAt(0)) | 0;
      seed = Math.abs(seed) ^ (teamId * 7919);
      const rng = () => {
        seed = (Math.imul(seed | 0, 1664525) + 1013904223) | 0;
        return (seed >>> 0) / 4294967296;
      };

      // Probability of having spent time on ≥1 prior team:
      // Short career (1-3yr) → 20%, medium (4-6yr) → 52%, long (7-9yr) → 72%, 10+yr → 88%
      const travelProb = n <= 3 ? 0.20 : n <= 6 ? 0.52 : n <= 9 ? 0.72 : 0.88;
      if (rng() >= travelProb) {
        hist.forEach(row => { row.teamId = teamId; row.teamName = teamName; });
        p._careerTeamsAssigned = true;
        continue;
      }

      // How many seasons on CURRENT team? Skewed recent — most trades/signings
      // are in the last 1-4 years. Always ≥1 and ≤ n-1.
      const maxCur = n - 1;
      const seasonsOnCurrent = rng() < 0.60
        ? 1 + Math.floor(rng() * Math.min(3, maxCur))   // recent signing: 1-3yr
        : 1 + Math.floor(rng() * maxCur);                // or anywhere in career
      const priorSeasons = n - seasonsOnCurrent;

      if (priorSeasons <= 0) {
        hist.forEach(row => { row.teamId = teamId; row.teamName = teamName; });
        p._careerTeamsAssigned = true;
        continue;
      }

      // How many distinct prior teams? Caps at 3; short prior stretches stay at 1.
      const maxPrior = priorSeasons <= 2 ? 1 : priorSeasons <= 5 ? 2 : 3;
      const numPrior = 1 + Math.floor(rng() * maxPrior);

      // Pick distinct prior teams (not current)
      const others = TEAMS.filter(t => t.id !== teamId);
      const priorTeams = [];
      const used = new Set();
      for (let k = 0; k < numPrior && priorTeams.length < others.length; k++) {
        let idx;
        let attempts = 0;
        do { idx = Math.floor(rng() * others.length); } while (used.has(idx) && ++attempts < 20);
        used.add(idx);
        priorTeams.push(others[idx]);
      }

      // Distribute priorSeasons across priorTeams (at least 1yr each)
      const assignment = new Array(priorSeasons); // season index → team
      let cursor = 0;
      for (let k = 0; k < priorTeams.length; k++) {
        const isLast = k === priorTeams.length - 1;
        let years;
        if (isLast) {
          years = priorSeasons - cursor;
        } else {
          const slack = priorSeasons - cursor - (priorTeams.length - k - 1);
          years = Math.max(1, 1 + Math.floor(rng() * slack));
        }
        for (let j = 0; j < years && cursor < priorSeasons; j++, cursor++) {
          assignment[cursor] = priorTeams[k];
        }
      }

      // Apply to history rows (prior seasons come first chronologically)
      for (let i = 0; i < n; i++) {
        if (i < priorSeasons && assignment[i]) {
          const t = assignment[i];
          hist[i].teamId   = t.id;
          hist[i].teamName = `${t.city} ${t.name}`;
        } else {
          hist[i].teamId   = teamId;
          hist[i].teamName = teamName;
        }
      }
      p._careerTeamsAssigned = true;
    }
  }
}

function mockSeasonStats(pos, ovr, archetype) {
  const noise = () => (Math.random() - 0.4) * 0.30 + 1;   // 0.85–1.16 typical
  const r = (n) => Math.round(n);

  // --- Games played: scale by ovr tier, clamp [1, 17] ---
  let gp;
  if (ovr >= 82)      gp = Math.round(14 + Math.random() * 3);
  else if (ovr >= 72) gp = Math.round(10 + Math.random() * 6);
  else if (ovr >= 62) gp = Math.round(5  + Math.random() * 7);
  else                gp = Math.round(1  + Math.random() * 5);
  gp = Math.min(17, Math.max(1, gp));

  const gpF = gp / 17;
  // rc() scales a full-season base count down to games-played equivalent
  const rc = (n) => Math.round(n * gpF);

  if (pos === "QB") {
    // --- base formula variables ---
    let attBase = (420 + (ovr - 70) * 9);
    let cmpPct  = Math.min(0.74, Math.max(0.48, 0.55 + (ovr - 70) * 0.0045));
    let ypa     = Math.max(5.2, 6.6 + (ovr - 70) * 0.06);
    let tdBase  = (18 + (ovr - 70) * 0.65);
    let intBase = (16 - (ovr - 70) * 0.22);

    // --- archetype modifiers (applied to base variables) ---
    let addRush = false;
    if (archetype === "GUNSLINGER") {
      tdBase  *= 1.25; intBase *= 1.30; ypa += 0.5; cmpPct -= 0.03;
    } else if (archetype === "GAME_MANAGER") {
      cmpPct  += 0.05; tdBase *= 0.75; intBase *= 0.65;
    } else if (archetype === "DUAL_THREAT") {
      cmpPct  -= 0.03; addRush = true;
    } else if (archetype === "FIELD_GENERAL") {
      cmpPct  += 0.03; intBase *= 0.75; ypa += 0.2;
    }
    cmpPct = Math.min(0.74, Math.max(0.48, cmpPct));

    // --- final counting stats ---
    const att  = Math.max(rc(60), rc(attBase * noise()));
    const comp = r(att * cmpPct);
    const yds  = r(att * ypa * noise());
    const td   = Math.max(rc(2), rc(tdBase * noise()));
    const ints = Math.max(rc(2), rc(Math.max(1, intBase) * noise()));

    const result = { gp, pass_att: att, pass_comp: comp, pass_yds: yds, pass_td: td, pass_int: ints };

    if (addRush) {
      const rush_att = rc((40 + (ovr - 70) * 1.5) * noise());
      const rush_yds = Math.round(rush_att * (4.5 + (ovr - 70) * 0.04) * noise());
      const rush_td  = Math.max(0, rc((3 + (ovr - 70) * 0.10) * noise()));
      result.rush_att = rush_att; result.rush_yds = rush_yds; result.rush_td = rush_td;
    }
    return result;
  }

  if (pos === "RB") {
    // --- base formula variables ---
    let attBase = (175 + (ovr - 70) * 6);
    let ypc     = Math.min(5.4, Math.max(3.1, 3.6 + (ovr - 70) * 0.038));
    let recBase = (20  + (ovr - 70) * 0.7);

    // --- archetype modifiers ---
    if (archetype === "POWER") {
      attBase *= 1.15; ypc -= 0.15; recBase *= 0.50;
    } else if (archetype === "ELUSIVE") {
      attBase *= 0.88; ypc += 0.25;
    } else if (archetype === "SPEED") {
      attBase *= 0.80; ypc += 0.45; recBase *= 0.65;
    } else if (archetype === "WORKHORSE") {
      attBase *= 1.20;
    } else if (archetype === "RECEIVING") {
      attBase *= 0.55; recBase *= 1.90;
    }
    ypc = Math.min(5.4, Math.max(3.1, ypc));

    // --- final counting stats ---
    const att = Math.max(rc(40), rc(attBase * noise()));
    const yds = r(att * ypc * noise());
    const td  = Math.max(rc(1), rc((6 + (ovr - 70) * 0.22) * noise()));
    const rec = Math.max(0, rc(recBase * noise()));
    const recYds = r(rec * 8.5);
    // Receiving TDs scale with rec volume — receiving backs catch more TDs.
    const recTdRate = archetype === "RECEIVING" ? 0.10 : 0.06;
    const recTd = Math.max(0, rc(rec * recTdRate * noise()));
    return { gp, rush_att: att, rush_yds: yds, rush_td: td,
             rec, rec_tgt: r(rec / 0.72), rec_yds: recYds, rec_td: recTd };
  }

  if (pos === "WR") {
    // --- base formula variables ---
    let tgtBase = (95  + (ovr - 70) * 3.5);
    let recRate = Math.min(0.78, Math.max(0.5, 0.60 + (ovr - 70) * 0.003));
    let yprBase = Math.min(17, Math.max(8, 12 + (ovr - 70) * 0.09));
    let tdBase  = (5   + (ovr - 70) * 0.18);

    // --- archetype modifiers ---
    if (archetype === "DEEP_THREAT") {
      tgtBase *= 0.72; yprBase *= 1.42; recRate -= 0.07; tdBase *= 1.10;
    } else if (archetype === "POSSESSION") {
      tgtBase *= 1.18; yprBase *= 0.80; recRate += 0.09; tdBase *= 0.80;
    } else if (archetype === "SLOT") {
      tgtBase *= 1.28; yprBase *= 0.88; recRate += 0.04;
    } else if (archetype === "RED_ZONE") {
      tgtBase *= 0.75; yprBase *= 0.82; tdBase  *= 1.55;
    } else if (archetype === "ROUTE_RUNNER") {
      recRate += 0.07; tgtBase *= 1.05;
    }
    recRate = Math.min(0.78, Math.max(0.5, recRate));
    yprBase = Math.min(17, Math.max(8, yprBase));

    // --- final counting stats ---
    const tgt = Math.max(rc(20), rc(tgtBase * noise()));
    const rec = r(tgt * recRate);
    const yds = r(rec * yprBase * noise());
    const td  = Math.max(0, rc(tdBase * noise()));
    return { gp, rec_tgt: tgt, rec, rec_yds: yds, rec_td: td };
  }

  if (pos === "TE") {
    // --- base formula variables ---
    let tgtBase = (70  + (ovr - 70) * 3.5);
    let recRate = Math.min(0.78, Math.max(0.5, 0.60 + (ovr - 70) * 0.003));
    let yprBase = Math.min(17, Math.max(8, 11 + (ovr - 70) * 0.09));
    let tdBase  = (4   + (ovr - 70) * 0.18);

    // --- archetype modifiers ---
    if (archetype === "BLOCKING") {
      tgtBase *= 0.28; tdBase *= 0.45; recRate -= 0.08;
    } else if (archetype === "RECEIVING") {
      tgtBase *= 1.25; yprBase *= 1.08;
    }
    recRate = Math.min(0.78, Math.max(0.5, recRate));
    yprBase = Math.min(17, Math.max(8, yprBase));

    // --- final counting stats ---
    const tgt = Math.max(rc(20), rc(tgtBase * noise()));
    const rec = r(tgt * recRate);
    const yds = r(rec * yprBase * noise());
    const td  = Math.max(0, rc(tdBase * noise()));
    return { gp, rec_tgt: tgt, rec, rec_yds: yds, rec_td: td };
  }

  if (pos === "DL") {
    // --- base formula variables ---
    let skBase  = Math.max(1.5, 4 + (ovr - 70) * 0.30);
    let tklBase = Math.max(10,  45 + (ovr - 70) * 1.2);
    const ffBase  = Math.max(0.5, 1 + (ovr - 70) * 0.04);
    const pdBase  = Math.max(1,   3 + (ovr - 70) * 0.10);

    // --- archetype modifiers ---
    if (archetype === "SPEED" || archetype === "PENETRATOR") {
      skBase  *= 1.45; tklBase *= 0.80;
    } else if (archetype === "POWER") {
      skBase  *= 0.75; tklBase *= 1.30;
    } else if (archetype === "TECHNICIAN") {
      skBase  *= 1.15;
    }
    // TWEENER: no change

    // --- final counting stats ---
    const sk  = Math.round(Math.max(0, rc(skBase  * noise())) * 10) / 10;
    const tkl = Math.max(0, rc(tklBase * noise()));
    const ff  = Math.max(0, rc(ffBase  * noise()));
    const pd  = Math.max(0, rc(pdBase  * noise()));
    const fr  = Math.max(0, rc(ffBase * 0.5 * noise()));
    const def_td = Math.random() < 0.10 ? 1 : 0;
    return { gp, sk, tkl, ff, pd, fr, def_td };
  }

  if (pos === "LB") {
    // --- base formula variables ---
    let skBase  = Math.max(0.8, 2 + (ovr - 70) * 0.20);
    let tklBase = Math.max(25,  70 + (ovr - 70) * 1.6);
    const ffBase  = Math.max(0.5, 1 + (ovr - 70) * 0.04);
    let intBase = Math.max(0.5, 1 + (ovr - 70) * 0.06);

    // --- archetype modifiers ---
    if (archetype === "BLITZER") {
      skBase  *= 1.70; tklBase *= 0.72; intBase *= 0.45;
    } else if (archetype === "THUMPER") {
      skBase  *= 0.50; tklBase *= 1.35; intBase *= 0.40;
    } else if (archetype === "COVER") {
      skBase  *= 0.65; tklBase *= 0.78; intBase *= 2.10;
    }
    // SIGNAL / HYBRID: no change

    // --- final counting stats ---
    const sk       = Math.round(Math.max(0, rc(skBase  * noise())) * 10) / 10;
    const tkl      = Math.max(0, rc(tklBase * noise()));
    const ff       = Math.max(0, rc(ffBase  * noise()));
    const int_made = Math.max(0, rc(intBase * noise()));
    const pd       = Math.max(0, rc((4 + (ovr - 70) * 0.15) * noise()));
    const fr       = Math.max(0, rc(ffBase * 0.5 * noise()));
    const def_td   = Math.random() < 0.08 ? 1 : 0;
    return { gp, sk, tkl, ff, int_made, pd, fr, def_td };
  }

  if (pos === "CB") {
    // --- base formula variables ---
    let intBase = Math.max(0.5, 2  + (ovr - 70) * 0.14);
    let pdBase  = Math.max(2,   10 + (ovr - 70) * 0.50);
    let tklBase = Math.max(12,  50 + (ovr - 70) * 0.7);

    // --- archetype modifiers ---
    if (archetype === "BALL_HAWK") {
      intBase *= 1.65; pdBase  *= 0.80; tklBase *= 1.15;
    } else if (archetype === "SHUTDOWN") {
      intBase *= 0.45; pdBase  *= 1.35;
    } else if (archetype === "PHYSICAL") {
      tklBase *= 1.40; intBase *= 0.80;
    } else if (archetype === "ZONE") {
      pdBase  *= 1.45; intBase *= 0.65; tklBase *= 0.82;
    } else if (archetype === "SLOT_CB") {
      tklBase *= 1.15;
    }

    // --- final counting stats ---
    const int_made = Math.max(0, rc(intBase * noise()));
    const pd       = Math.max(0, rc(pdBase  * noise()));
    const tkl      = Math.max(0, rc(tklBase * noise()));
    const ff       = Math.max(0, rc(0.5 * noise()));
    const def_td   = Math.random() < 0.10 ? 1 : 0;
    return { gp, int_made, pd, tkl, ff, def_td };
  }

  if (pos === "S") {
    // --- base formula variables ---
    let intBase = Math.max(0.5, 1  + (ovr - 70) * 0.10);
    let tklBase = Math.max(20,  75 + (ovr - 70) * 1.0);
    let pdBase  = Math.max(1.5, 6  + (ovr - 70) * 0.30);
    const skBase  = Math.max(0.4, 1  + (ovr - 70) * 0.05);

    // --- archetype modifiers ---
    if (archetype === "BALL_HAWK") {
      intBase *= 1.80; tklBase *= 0.78;
    } else if (archetype === "BOX") {
      intBase *= 0.38; tklBase *= 1.50; pdBase  *= 0.70;
    } else if (archetype === "CENTER_FIELD") {
      intBase *= 1.25; tklBase *= 0.62; pdBase  *= 1.30;
    }
    // HYBRID: no change

    // --- final counting stats ---
    const int_made = Math.max(0, rc(intBase * noise()));
    const tkl      = Math.max(0, rc(tklBase * noise()));
    const pd       = Math.max(0, rc(pdBase  * noise()));
    const sk       = Math.round(Math.max(0, rc(skBase  * noise())) * 10) / 10;
    const ff       = Math.max(0, rc(0.8 * noise()));
    const def_td   = Math.random() < 0.10 ? 1 : 0;
    return { gp, int_made, tkl, pd, sk, ff, def_td };
  }

  if (pos === "OL") {
    const pen           = Math.max(0, rc((4 - (ovr - 70) * 0.08) * noise()));
    const sacks_allowed = Math.max(0, rc((4 - (ovr - 70) * 0.07) * noise()));
    return { gp, gs: gp, sacks_allowed, penalties: pen };
  }

  if (pos === "K") {
    // FG accuracy scales with OVR (~75% league avg, ~92% elite).
    const fgPct = Math.min(0.95, Math.max(0.62, 0.74 + (ovr - 70) * 0.005));
    const fg_att  = Math.max(rc(8), rc((22 + (ovr - 70) * 0.4) * noise()));
    const fg_made = Math.min(fg_att, r(fg_att * fgPct * noise()));
    const fg_long = Math.max(38, Math.min(60, Math.round(45 + (ovr - 70) * 0.4 + (Math.random() * 6 - 3))));
    const xp_att  = Math.max(rc(12), rc((28 + (ovr - 70) * 0.3) * noise()));
    const xp_made = Math.min(xp_att, r(xp_att * Math.min(0.99, 0.92 + (ovr - 70) * 0.003) * noise()));
    return { gp, fg_made, fg_att, fg_long, xp_made, xp_att };
  }

  if (pos === "P") {
    const punts = Math.max(rc(20), rc((58 - (ovr - 70) * 0.2) * noise()));
    const avgYds = Math.min(52, Math.max(38, 44 + (ovr - 70) * 0.25));
    return { gp, punts, punt_yds: r(punts * avgYds), punt_long: Math.max(50, Math.min(75, Math.round(58 + (ovr - 70) * 0.4))) };
  }

  return { gp };
}

function generateAccolades(player, season, effOvr, seasonAge) {
  const acc = [];
  // Pro Bowl — needs ~88+ OVR season; some elite hover at 84+
  if (effOvr >= 92 && Math.random() < 0.80) acc.push("Pro Bowl");
  else if (effOvr >= 88 && Math.random() < 0.55) acc.push("Pro Bowl");
  else if (effOvr >= 84 && Math.random() < 0.20) acc.push("Pro Bowl");
  // All-Pro — needs Pro Bowl + truly elite
  if (acc.includes("Pro Bowl") && effOvr >= 93 && Math.random() < 0.35) acc.push("All-Pro");
  // Super Bowl ring — random per season, slightly weighted by OVR
  if (Math.random() < 0.05 + Math.max(0, (effOvr - 75) / 200)) acc.push("Super Bowl");
  // MVP — extremely rare, only top QBs/RBs/WRs
  if (effOvr >= 96 && Math.random() < 0.20 && ["QB","RB","WR"].includes(player.position)) acc.push("MVP");
  // OPOY / DPOY — slightly less rare than MVP
  if (effOvr >= 94 && Math.random() < 0.15) {
    if (["QB","RB","WR","TE"].includes(player.position)) acc.push("OPOY");
    else if (["DL","LB","CB","S"].includes(player.position)) acc.push("DPOY");
  }
  // Rookie of the Year — first season only
  if (seasonAge <= 23 && effOvr >= 82 && Math.random() < 0.06) acc.push("ROY");
  return acc;
}

function computeCareerTotals(career, pos) {
  const totals = { gp: 0,
    pass_att: 0, pass_comp: 0, pass_yds: 0, pass_td: 0, pass_int: 0,
    rush_att: 0, rush_yds: 0, rush_td: 0,
    rec_tgt: 0, rec: 0, rec_yds: 0, rec_td: 0,
    tkl: 0, sk: 0, int_made: 0, ff: 0, pd: 0,
  };
  for (const s of career) {
    for (const k of Object.keys(totals)) {
      if (s[k] != null) totals[k] += s[k];
    }
  }
  // Round sacks to 1 decimal (they're floats)
  totals.sk = Math.round(totals.sk * 10) / 10;
  return totals;
}

function generateRecords(player, career, bestOvr) {
  const records = [];
  if (bestOvr < 95) return records;   // only legends hold records
  const pos = player.position;
  const best = career.reduce((a, b) => (b.ovr > (a?.ovr || 0) ? b : a), null);
  if (!best) return records;
  if (pos === "QB" && best.pass_yds >= 5000)   records.push(`${best.pass_yds} pass yds (${best.year})`);
  if (pos === "QB" && best.pass_td >= 45)       records.push(`${best.pass_td} pass TDs (${best.year})`);
  if (pos === "RB" && best.rush_yds >= 1800)    records.push(`${best.rush_yds} rush yds (${best.year})`);
  if (pos === "RB" && best.rush_td >= 18)       records.push(`${best.rush_td} rush TDs (${best.year})`);
  if (pos === "WR" && best.rec_yds >= 1600)     records.push(`${best.rec_yds} rec yds (${best.year})`);
  if (pos === "WR" && best.rec_td >= 15)        records.push(`${best.rec_td} rec TDs (${best.year})`);
  if (pos === "DL" && best.sk >= 18)             records.push(`${best.sk} sacks (${best.year})`);
  if (pos === "LB" && best.tkl >= 160)           records.push(`${best.tkl} tackles (${best.year})`);
  if ((pos === "CB" || pos === "S") && best.int_made >= 9) records.push(`${best.int_made} INTs (${best.year})`);
  return records;
}
// Generates a player whose name isn't already in `blockNames`. Falls back to
// appending a roman-numeral suffix after exhausting random retries.
function genUniquePlayer(pos, tier, blockNames) {
  const block = blockNames || new Set();
  let p = genPlayer(pos, tier);
  let attempts = 0;
  while (block.has(p.name) && attempts < 30) {
    p = genPlayer(pos, tier);
    attempts++;
  }
  if (block.has(p.name)) {
    const suffixes = ["II", "III", "IV", "V", "VI", "VII"];
    for (const s of suffixes) {
      const candidate = `${p.name} ${s}`;
      if (!block.has(candidate)) { p.name = candidate; break; }
    }
  }
  return p;
}
function genRoster(playbook = PLAYBOOKS.BALANCED, overrides = {}, blockNames = null) {
  const r = [];
  const used = new Set(blockNames || []);
  // NFL-shaped depth chart. The old version produced a compressed league:
  // ~10 players at 90+ leaguewide, zero at 95+, every team identically
  // structured (#1 always "good" → max 80 OVR). Now each depth slot has a
  // probability mix matching how NFL teams actually look:
  //   #1 starter:  some chance of elite (78-99) — these are the league's
  //                superstars, ~12% per team-#1 ≈ ~3-4 leaguewide per
  //                position → matches NFL's "30-40 at 90+" tail.
  //   #2 starter:  good/average mix — solid contributors w/ one weak spot.
  //   #3 depth:    average/poor mix — backups + special teamers.
  //   #4+ depth:   mostly poor — bottom of roster + camp bodies.
  // Override + playbook tierBias still drive the starter when set (used by
  // tests / scripted scenarios that need a fixed starter quality).
  function pickTier(depth) {
    if (depth === 0) {
      const r = Math.random();
      if (r < 0.12) return "elite";       // ~3-4 at 90+ per position leaguewide
      if (r < 0.65) return "good";        // most starters
      return "average";                    // weak starters (still better than backups)
    }
    if (depth === 1) return Math.random() < 0.5 ? "good" : "average";
    if (depth === 2) return Math.random() < 0.5 ? "average" : "poor";
    return Math.random() < 0.25 ? "average" : "poor";
  }
  for (const [pos, count] of Object.entries(ROSTER_SLOTS)) {
    for (let i = 0; i < count; i++) {
      let tier;
      if (i === 0) tier = overrides[pos] || playbook.tierBias[pos] || pickTier(0);
      else tier = pickTier(i);
      const player = genUniquePlayer(pos, tier, used);
      used.add(player.name);
      r.push(player);
    }
  }
  // Resolve per-team jersey number conflicts (best player keeps their college
  // digit; rookies whose # is taken switch to a position-pool alternate).
  assignTeamJerseyNumbers(r);
  return r;
}

