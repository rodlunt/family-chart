import { createNewPerson } from "./new-person"
import { Data, Datum } from "../types/data"
import { AddRelative } from "../core/add-relative"

export type AddRelativeType = 'father' | 'mother' | 'spouse' | 'son' | 'daughter'

interface NewDatum extends Datum {
  _new_rel_data?: {
    rel_type: AddRelativeType
    label: string
    rel_id: string,
    other_parent_id?: Datum['id']
  }
}

export function updateGendersForNewRelatives(updated_datum: Datum, data: Data) {
  // if gender on main datum is changed, we need to switch mother/father ids for new children
  data.forEach(d => {
    const rd = d._new_rel_data
    if (!rd) return
    if (rd.rel_type === 'spouse') d.data.gender = d.data.gender === 'M' ? 'F' : 'M'
  })
}

export function cleanUp(data: Data) {
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i]
    if (d._new_rel_data) {
      data.forEach(d2 => {
        if (d2.rels.parents.includes(d.id)) d2.rels.parents.splice(d2.rels.parents.indexOf(d.id), 1)
        if (d2.rels.children && d2.rels.children.includes(d.id)) d2.rels.children.splice(d2.rels.children.indexOf(d.id), 1)
        if (d2.rels.spouses && d2.rels.spouses.includes(d.id)) d2.rels.spouses.splice(d2.rels.spouses.indexOf(d.id), 1)
      })
      data.splice(i, 1)
    }
  }
}

/**
 * What relationship-type choices the add-relative wizard should offer for `datum`, given
 * `canAdd`'s slot customisation (same `{parent?, spouse?, child?}` config as the old
 * all-5-ghosts-at-once flow used). Parent slots are limited to one father + one mother, so
 * `father_open`/`mother_open` let the wizard skip the father-vs-mother sub-step when only one
 * is actually available. Spouse and child are never slot-limited (matching the old flow,
 * which always offered "Add Spouse" and always offered son/daughter once a spouse existed).
 */
export function getAddRelativeAvailability(datum: Datum, store_data: Data, canAdd?: AddRelative['canAdd']) {
  let can_add = {parent: true, spouse: true, child: true}
  if (canAdd) can_add = Object.assign(can_add, canAdd(datum))

  const parents = datum.rels.parents
  const has_father = !!parents.find(d_id => store_data.find(d => d.id === d_id)?.data.gender === "M")
  const has_mother = !!parents.find(d_id => store_data.find(d => d.id === d_id)?.data.gender === "F")
  const father_open = can_add.parent && parents.length < 2 && !has_father
  const mother_open = can_add.parent && parents.length < 2 && !has_mother

  return {
    parent: father_open || mother_open,
    father_open,
    mother_open,
    spouse: can_add.spouse,
    child: can_add.child,
  }
}

/**
 * Creates exactly one `_new_rel_data`-tagged placeholder person for `rel_type` and wires it
 * into `datum.rels`/`store_data`, matching the shape the old all-5-at-once
 * `addDatumRelsPlaceholders` produced for that same relationship type - the rest of the
 * pipeline (`getLinkRelOptions`, `handleLinkRel`, the new-rel edit form, cleanup on cancel)
 * depends on that shape, not on how many placeholders were created at once.
 *
 * For 'son'/'daughter', the child needs a second parent: the datum's first existing spouse if
 * it has one, otherwise a fresh spouse placeholder is created silently first (mirroring the
 * old flow, where a generic "Add Spouse" ghost was always created before any child ghosts).
 * If `datum` already has more than one spouse, the new child is attached to the first one -
 * a deliberate simplification for this PR (see PR description) rather than adding a spouse
 * picker sub-step that nothing in the design brief asked for.
 */
export function createSingleRelPlaceholder(
  datum: Datum,
  store_data: Data,
  rel_type: AddRelativeType,
  addRelLabels: AddRelative['addRelLabels']
): NewDatum {
  if (!datum.rels.spouses) datum.rels.spouses = []
  if (!datum.rels.children) datum.rels.children = []

  if (rel_type === 'father' || rel_type === 'mother') return addParent(rel_type)
  if (rel_type === 'spouse') return addSpouse()
  return addChild(rel_type)

  function addParent(which: 'father' | 'mother') {
    const gender = which === 'father' ? 'M' : 'F'
    const parent: NewDatum = createNewPerson({data: {gender}, rels: {children: [datum.id]}})
    parent._new_rel_data = {rel_type: which, label: addRelLabels[which], rel_id: datum.id}
    datum.rels.parents.push(parent.id)
    store_data.push(parent)

    if (datum.rels.parents.length === 2) {
      const p1 = store_data.find(d => d.id === datum.rels.parents[0])!
      const p2 = store_data.find(d => d.id === datum.rels.parents[1])!

      if (!p1.rels.spouses) p1.rels.spouses = []
      if (!p2.rels.spouses) p2.rels.spouses = []
      if (!p1.rels.spouses.includes(p2.id)) p1.rels.spouses.push(p2.id)
      if (!p2.rels.spouses.includes(p1.id)) p2.rels.spouses.push(p1.id)

      if (!p1.rels.children) p1.rels.children = []
      if (!p2.rels.children) p2.rels.children = []
      if (!p1.rels.children.includes(datum.id)) p1.rels.children.push(datum.id)
      if (!p2.rels.children.includes(datum.id)) p2.rels.children.push(datum.id)
    }

    return parent
  }

  function addSpouse() {
    const spouse_gender = datum.data.gender === "M" ? "F" : "M"
    const spouse: NewDatum = createNewPerson({data: {gender: spouse_gender}, rels: {spouses: [datum.id]}})
    spouse._new_rel_data = {rel_type: "spouse", label: addRelLabels.spouse, rel_id: datum.id}
    datum.rels.spouses!.push(spouse.id)
    store_data.push(spouse)
    return spouse
  }

  function addChild(which: 'son' | 'daughter') {
    const existing_spouse_id = datum.rels.spouses![0]
    const spouse = (existing_spouse_id && store_data.find(d => d.id === existing_spouse_id)) || addSpouse()
    if (!spouse.rels.children) spouse.rels.children = []

    const gender = which === 'son' ? 'M' : 'F'
    const child: NewDatum = createNewPerson({data: {gender}, rels: {parents: [datum.id, spouse.id]}})
    child._new_rel_data = {rel_type: which, label: addRelLabels[which], other_parent_id: spouse.id, rel_id: datum.id}
    spouse.rels.children.push(child.id)
    datum.rels.children!.push(child.id)
    store_data.push(child)
    return child
  }
}
