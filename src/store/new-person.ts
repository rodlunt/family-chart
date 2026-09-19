import { Data, Datum } from "../types/data"

type RelType = 'daughter' | 'son' | 'mother' | 'father' | 'spouse'

// The one place that says which gender a relation slot requires. father/son are fixed
// male, mother/daughter fixed female; spouse has no fixed gender (a spouse placeholder's
// gender is freely editable, see createRelsToAdd in layout/calculate-tree.ts), so it
// returns undefined rather than guessing - callers decide their own spouse handling.
export function fixedGenderForRelType(rel_type: RelType): Datum['data']['gender'] | undefined {
  if (rel_type === 'father' || rel_type === 'son') return 'M'
  if (rel_type === 'mother' || rel_type === 'daughter') return 'F'
  return undefined
}

export function createNewPerson({data, rels}: {data: Datum['data'], rels?: {parents?: string[], spouses?: string[], children?: string[]}}) {
  return {
    id: generateUUID(),
    data: data || {},
    rels: {
      ...{parents: [], children: [], spouses: []},
      ...(rels || {})}
    }
}

export function createNewPersonWithGenderFromRel({data, rel_type, rel_datum}: {data: Datum['data'], rel_type: RelType, rel_datum: Datum}) {
  const gender = getGenderFromRelative(rel_datum, rel_type)
  data = Object.assign(data || {}, {gender})
  return createNewPerson({data})

  function getGenderFromRelative(rel_datum: Datum, rel_type: RelType) {
    return fixedGenderForRelType(rel_type) ?? (rel_datum.data.gender === "M" ? "F" : "M")  // spouse: opposite of the person they're being added to
  }
}

export function addNewPerson({data_stash, datum}: {data_stash: Data, datum: Datum}) {
  data_stash.push(datum)
}

function generateUUID() {
  var d = new Date().getTime();
  var d2 = (performance && performance.now && (performance.now()*1000)) || 0;//Time in microseconds since page-load or 0 if unsupported
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16;
    if(d > 0){//Use timestamp until depleted
      r = (d + r)%16 | 0;
      d = Math.floor(d/16);
    } else {//Use microseconds since page-load if supported
      r = (d2 + r)%16 | 0;
      d2 = Math.floor(d2/16);
    }
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
