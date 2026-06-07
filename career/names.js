// Name generation. Big enough pool that draft classes have variety.

const FIRST = [
  "Marcus","Tyler","Darius","Jordan","Malik","Devon","Elijah","Xavier","Cameron","Jaylen",
  "Trevor","Caleb","Nathan","Brandon","Derrick","Antonio","Deon","Travon","Rasheed","Quincy",
  "Zach","Hunter","Brayden","Cole","Jake","Ryan","Luke","Evan","Aaron","Chris",
  "Isaiah","Jamal","Tyrone","Lamar","Andre","Reggie","Stefon","Amari","Cooper","Travis",
  "Kyler","Dak","Patrick","Joe","Justin","Trevor","Mac","Tua","Daniel","Russell",
  "Derrick","Saquon","Christian","Nick","Alvin","Aaron","Ezekiel","Jonathan","Najee","Joe",
  "Tyreek","Davante","DeAndre","Stefon","Justin","Cooper","CeeDee","Ja'Marr","Mike","Calvin",
  "Trent","Quentin","Lane","Ronnie","Tristan","Andrew","Garett","Mekhi","Penei","Tyron",
  "Aaron","Khalil","Joey","Maxx","Nick","Myles","Chase","T.J.","Robert","Bobby",
  "Patrick","Jalen","Marlon","Stephon","Tre'Davious","Jaire","Marshon","Xavien","Denzel","A.J.",
];

const LAST = [
  "Johnson","Williams","Brown","Jones","Davis","Miller","Wilson","Moore","Taylor","Anderson",
  "Thomas","Jackson","White","Harris","Martin","Thompson","Garcia","Martinez","Robinson","Clark",
  "Rodriguez","Lewis","Lee","Walker","Hall","Allen","Young","Hill","Flores","Green",
  "Adams","Nelson","Baker","Carter","Mitchell","Roberts","Turner","Phillips","Campbell","Reed",
  "Mahomes","Murray","Prescott","Burrow","Allen","Herbert","Lawrence","Jones","Wilson","Young",
  "Henry","Barkley","McCaffrey","Chubb","Kamara","Jacobs","Elliott","Taylor","Harris","Mixon",
  "Hill","Adams","Hopkins","Diggs","Jefferson","Kupp","Lamb","Chase","Evans","Ridley",
  "Williams","Nelson","Johnson","Stanley","Wirfs","Thomas","Bolton","Sewell","Young","Smith",
  "Donald","Mack","Bosa","Crosby","Hendrickson","Garrett","Young","Watt","Quinn","Wagner",
  "Surtain","Ramsey","Humphrey","Gilmore","Alexander","Diggs","Lattimore","Howard","Ward","Bouye",
];

import { pick } from "./random.js";

export function randomName(rng) {
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}
