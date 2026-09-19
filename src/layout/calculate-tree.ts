import * as d3 from "d3";
import { sortChildrenWithSpouses, sortAddNewChildren, setupSiblings, handlePrivateCards } from "./handlers";
import { createNewPerson } from "../store/new-person";
import { isAllRelativeDisplayed } from "../handlers/general";
import { handleDuplicateSpouseToggle, handleDuplicateHierarchyProgeny } from "../features/duplicates-toggle/duplicates-progeny";
import { handleDuplicateHierarchyAncestry } from "../features/duplicates-toggle/duplicates-ancestry";
import type { Datum, Data } from "../types/data";
import type { TreeDatum, TreeData } from "../types/treeData";

interface HN extends d3.HierarchyNode<Datum> {}

export interface CalculateTreeOptions {
  main_id?: string | null;
  node_separation?: number;
  level_separation?: number;
  single_parent_empty_card?: boolean;
  is_horizontal?: boolean;
  one_level_rels?: boolean;
  sortChildrenFunction?: ((a: Datum, b: Datum) => number) | undefined;
  sortSpousesFunction?: ((d: Datum, data: Data) => void) | undefined;
  ancestry_depth?: number | undefined;
  progeny_depth?: number | undefined;
  show_siblings_of_main?: boolean;
  modifyTreeHierarchy?: (tree: HN, is_ancestry: boolean) => void;
  private_cards_config?: any;
  duplicate_branch_toggle?: boolean;
  on_toggle_one_close_others?: boolean;
  show_unconnected?: boolean;  // whether people with no path back to main are rendered as floating cards (see placeUnconnected below)
}

export interface Tree {
  data: TreeData;
  data_stash: Data;
  dim: { width: number; height: number; x_off: number; y_off: number };
  main_id: string;
  is_horizontal: boolean;
}


export default function calculateTree(data: Data, {
  main_id = null,
  node_separation = 250,
  level_separation = 150,
  single_parent_empty_card = true,
  is_horizontal = false,
  one_level_rels = false,
  sortChildrenFunction = undefined,
  sortSpousesFunction = undefined,
  ancestry_depth = undefined,
  progeny_depth = undefined,
  show_siblings_of_main = false,
  modifyTreeHierarchy=undefined,
  private_cards_config = undefined,
  duplicate_branch_toggle = false,
  on_toggle_one_close_others = true,
  show_unconnected = true,  // default on: floating cards are shown unless the caller opts out
}: CalculateTreeOptions): Tree {
  if (!data || !data.length) throw new Error('No data')

  if (is_horizontal) [node_separation, level_separation] = [level_separation, node_separation]
  const data_stash:Data = single_parent_empty_card ? createRelsToAdd(data) : data

  if (!main_id || !data_stash.find(d => d.id === main_id)) main_id = data_stash[0].id
  const main = data_stash.find(d => d.id === main_id)
  if (!main) throw new Error('Main not found')

  const tree_children = calculateTreePositions(main, 'children', false) as TreeDatum[]
  const tree_parents = calculateTreePositions(main, 'parents', true) as TreeDatum[]

  data_stash.forEach(d => d.main = d === main)
  levelOutEachSide(tree_parents, tree_children)
  const tree = mergeSides(tree_parents, tree_children)
  setupChildrenAndParents(tree)
  setupSpouses(tree, node_separation)
  if (show_siblings_of_main && !one_level_rels) setupSiblings({tree, data_stash, node_separation, sortChildrenFunction})
  setupProgenyParentsPos(tree)
  nodePositioning(tree)
  tree.forEach(d => d.all_rels_displayed = isAllRelativeDisplayed(d, tree))
  if (private_cards_config) handlePrivateCards({tree, data_stash, private_cards_config})
  setupTid(tree)
  // setupFromTo(tree)
  if (duplicate_branch_toggle) handleDuplicateSpouseToggle(tree)
  if (show_unconnected) placeUnconnected(tree, data_stash, node_separation, level_separation, main.id)  // append floating cards for anyone not reachable from main, unless turned off
  const dim = calculateTreeDim(tree, node_separation, level_separation)  // focused mode hides disconnected branches; full-tree mode includes and fits them

  return {data: tree, data_stash, dim, main_id: main.id, is_horizontal}

  function calculateTreePositions(datum:Datum, rt:'children' | 'parents', is_ancestry:boolean) {
    const hierarchyGetter = rt === "children" ? hierarchyGetterChildren : hierarchyGetterParents
    const d3_tree = d3.tree<Datum>().nodeSize([node_separation, level_separation]).separation(separation)
    const root = d3.hierarchy<Datum>(datum, hierarchyGetter)

    trimTree(root, is_ancestry)
    if (duplicate_branch_toggle) handleDuplicateHierarchy(root, data_stash, is_ancestry)
    if (modifyTreeHierarchy) modifyTreeHierarchy(root, is_ancestry)
    d3_tree(root);
    const tree = root.descendants()
    tree.forEach(d => {
      if (d.x === undefined) d.x = 0
      if (d.y === undefined) d.y = 0
    })
    return tree

    function separation(a:HN, b:HN) {
      let offset = 1;
      if (!is_ancestry) {
        if (!sameParent(a, b)) offset+=.25
        if (!one_level_rels) {
          if (someSpouses(a,b)) offset+=offsetOnPartners(a,b)
        }
        if (sameParent(a, b) && !sameBothParents(a,b)) offset+=.125
      }
      return offset
    }

    function hasCh(d:HN) {return !!d.children}
    function sameParent(a:HN, b:HN) {return a.parent == b.parent}
    function sameBothParents(a: HN, b: HN) {
      const parentsA = [...a.data.rels.parents].sort();
      const parentsB = [...b.data.rels.parents].sort();
      return parentsA.length === parentsB.length && parentsA.every((p, i) => p === parentsB[i]);
    }
    function hasSpouses(d:HN) {return d.data.rels.spouses && d.data.rels.spouses.length > 0}
    function someSpouses(a:HN, b:HN) {return hasSpouses(a) || hasSpouses(b)}

    function hierarchyGetterChildren(d:Datum) {
      const children = [...(d.rels.children || [])].map(id => data_stash.find(d => d.id === id)).filter(d => d !== undefined)
      if (sortChildrenFunction) children.sort(sortChildrenFunction)  // first sort by custom function if provided
      sortAddNewChildren(children)  // then put new children at the end
      if (sortSpousesFunction) sortSpousesFunction(d, data_stash)
      sortChildrenWithSpouses(children, d, data_stash)  // then sort by order of spouses
      return children
    }

    function hierarchyGetterParents(d:Datum) {
      let parents = [...d.rels.parents]
      const p1 = data_stash.find(d => d.id === parents[0])
      if (p1 && p1.data.gender === "F") parents.reverse()

      return parents
        .filter(d => d).map(id => data_stash.find(d => d.id === id)).filter(d => d !== undefined)
    }

    function offsetOnPartners(a:HN, b:HN) {
      return ((a.data.rels.spouses || []).length + (b.data.rels.spouses || []).length)*.5
    }
  }

  function levelOutEachSide(parents:TreeDatum[], children:TreeDatum[]) {
    const mid_diff = (parents[0].x - children[0].x) / 2
    parents.forEach(d => d.x-=mid_diff)
    children.forEach(d => d.x+=mid_diff)
  }

  function mergeSides(parents:TreeDatum[], children:TreeDatum[]) {
    parents.forEach(d => {d.is_ancestry = true})
    parents.forEach(d => d.depth === 1 ? d.parent = children[0] : null)

    return [...children, ...parents.slice(1)];
  }
  function nodePositioning(tree:TreeDatum[]) {
    tree.forEach(d => {
      d.y *= (d.is_ancestry ? -1 : 1)
      if (is_horizontal) {
        const d_x = d.x; d.x = d.y; d.y = d_x
      }
    })
  }

  function setupSpouses(tree:TreeDatum[], node_separation:number) {
    for (let i = tree.length; i--;) {
      const d = tree[i]
      if (!d.is_ancestry) {
        let spouses = d.data.rels.spouses || []
        if (d._ignore_spouses) spouses = spouses.filter(sp_id => !d._ignore_spouses!.includes(sp_id))
        if (spouses.length > 0) {
          if (one_level_rels && d.depth > 0) continue
          const side = d.data.data.gender === "M" ? -1 : 1;  // female on right
          d.x += spouses.length/2*node_separation*side;
          spouses.forEach((sp_id, i) => {
            const spouse:TreeDatum = {
              data: data_stash.find(d0 => d0.id === sp_id) as Datum,
              added: true,
              depth: d.depth,
              spouse: d,
              x: d.x-(node_separation*(i+1))*side,
              y: d.y,
              tid: `${d.data.id}-spouse-${i}`,
            }
            spouse.sx = i > 0 ? spouse.x : spouse.x + (node_separation/2)*side
            spouse.sy = i > 0 ? spouse.y : spouse.y + (node_separation/2)*side
            if (!d.spouses) d.spouses = []
            d.spouses.push(spouse)
            tree.push(spouse)
          })
        }
      }
      if (d.parents && d.parents.length === 2) {
        const p1 = d.parents[0]
        const p2 = d.parents[1]
        const midd = p1.x - (p1.x - p2.x)/2
        const x = (d:TreeDatum, sp:TreeDatum) => midd + (node_separation/2)*(d.x < sp.x ? 1 : -1)

        p2.x = x(p1, p2); p1.x = x(p2, p1)
      }
    }
  }

  function setupProgenyParentsPos(tree:TreeDatum[]) {
    tree.forEach(d => {
      if (d.is_ancestry) return
      if (d.depth === 0) return
      if (d.added) return
      if (d.sibling) return
      const p1 = d.parent
      const p2 = (p1?.spouses || []).find((d0:TreeDatum) => d.data.rels.parents.includes(d0.data.id))
      if (p1 && p2) {
        if (!p1.added && !p2.added) console.error('no added spouse', p1, p2)
        const added_spouse = p1.added ? p1 : p2
        setupParentPos(d, added_spouse)
      } else if (p1 || p2) {
        const parent = p1 || p2
        if (!parent) throw new Error('no progeny parent')
        parent.sx = parent.x
        parent.sy = parent.y
        setupParentPos(d, parent)
      }

      function setupParentPos(d:TreeDatum, p:TreeDatum) {
        d.psx = !is_horizontal ? p.sx : p.y
        d.psy = !is_horizontal ? p.y : p.sx
      }
    })
  }

  function setupChildrenAndParents(tree:TreeDatum[]) {
    tree.forEach(d0 => {
      delete d0.children
      tree.forEach(d1 => {
        if (d1.parent === d0) {
          if (d1.is_ancestry) {
            if (!d0.parents) d0.parents = []
            d0.parents.push(d1)
          } else {
            if (!d0.children) d0.children = []
            d0.children.push(d1)
          }
        }
      })
      if (d0.parents && d0.parents.length === 2) {
        const p1 = d0.parents[0]
        const p2 = d0.parents[1]
        p1.coparent = p2
        p2.coparent = p1
      }
    })

  }

  /**
   * Lay out every person not represented in the focused hierarchy as compact supplemental
   * mini-trees. This includes disconnected candidate families and collateral relatives that
   * are related in the data but outside the library's ego-centric main-person traversal.
   */
  function placeUnconnected(tree:TreeDatum[], data_stash:Data, node_separation:number, level_separation:number, main_id:string) {
    const displayed_ids = new Set(tree.map(d => d.data.id))
    const confirmed_reachable_ids = getReachableIds(main_id, data_stash)
    const supplemental_ids = new Set(data_stash.filter(d => !displayed_ids.has(d.id)).map(d => d.id))
    const components:Data[] = []
    const visited = new Set<string>()

    data_stash.filter(d => supplemental_ids.has(d.id) && !d.to_add).forEach(seed => {
      if (visited.has(seed.id)) return
      const component_ids = getReachableWithin(seed.id, supplemental_ids)
      const component = data_stash.filter(d => component_ids.has(d.id))
      component.forEach(d => visited.add(d.id))
      components.push(component)
    })
    if (!components.length) return

    function getReachableWithin(start_id:string, allowed:Set<string>) {
      const found = new Set<string>()
      const queue = [start_id]
      while (queue.length) {
        const id = queue.pop() as string
        if (found.has(id) || !allowed.has(id)) continue
        found.add(id)
        const person = data_stash.find(d => d.id === id)
        if (!person) continue
        ;[...(person.rels.parents || []), ...(person.rels.spouses || []), ...(person.rels.children || [])]
          .forEach(relative_id => { if (allowed.has(relative_id)) queue.push(relative_id) })
      }
      return found
    }

    const component_layouts = components.map(component => {
      const component_ids = new Set(component.map(d => d.id))
      const layout_component = component.map(d => ({
        ...d,
        data: {...d.data},
        rels: {
          parents: (d.rels.parents || []).filter(id => component_ids.has(id)),
          spouses: (d.rels.spouses || []).filter(id => component_ids.has(id)),
          children: (d.rels.children || []).filter(id => component_ids.has(id)),
        },
      })) as Data  // isolate layout from relatives represented in another mini-tree or the focused hierarchy
      const real_people = layout_component.filter(d => !d.to_add)
      const roots = real_people.filter(d => !(d.rels.parents || []).some(id => component_ids.has(id)))
      const root = roots.sort((a, b) => (b.rels.children || []).length - (a.rels.children || []).length)[0] || real_people[0]
      const component_tree = calculateTree(layout_component, {
        main_id: root.id,
        node_separation,
        level_separation,
        single_parent_empty_card: false,  // placeholders were already created once for the complete data set
        is_horizontal,
        sortChildrenFunction,
        sortSpousesFunction,
        private_cards_config,
        duplicate_branch_toggle,
        on_toggle_one_close_others,
        show_unconnected: false,
      }).data

      component_tree.forEach(d => {
        d.data = data_stash.find(original => original.id === d.data.id) || d.data  // editing must target the real store record, not the isolated layout clone
        d.floating = !confirmed_reachable_ids.has(d.data.id)
      })
      const x_extent = d3.extent(component_tree, d => d.x) as [number, number]
      const y_extent = d3.extent(component_tree, d => d.y) as [number, number]
      const confirmed_anchor = component.flatMap(person =>
        (["parents", "spouses", "children"] as const).flatMap(kind =>
          (person.rels[kind] || [])
            .filter(relative_id => displayed_ids.has(relative_id))
            .map(relative_id => ({person_id: person.id, relative_id, kind}))
        )
      )[0]
      const unconfirmed_anchor = component.flatMap(person => {
        const relations = person.unconfirmed_rels || {}
        return (["parents", "spouses", "children"] as const).flatMap(kind =>
          (relations[kind] || [])
            .filter(relative_id => displayed_ids.has(relative_id))
            .map(relative_id => ({person_id: person.id, relative_id, kind}))
        )
      })[0]
      const anchor = confirmed_anchor || unconfirmed_anchor
      if (anchor) component_tree.forEach(d => d.floating = false)
      return {
        nodes: component_tree,
        min_x: x_extent[0],
        min_y: y_extent[0],
        width: x_extent[1] - x_extent[0] + node_separation,
        height: y_extent[1] - y_extent[0] + level_separation,
        anchor,
      }
    })

    const main_x = d3.extent(tree, d => d.x) as [number, number]
    const main_y = d3.extent(tree, d => d.y) as [number, number]
    const main_width = main_x[1] - main_x[0] + node_separation
    const total_area = component_layouts.reduce((sum, component) => sum + component.width * component.height, 0)
    const widest_component = Math.max(...component_layouts.map(component => component.width))
    const row_width = Math.max(main_width, widest_component, Math.sqrt(total_area) * 1.5)
    const gap_x = node_separation * .5
    const gap_y = level_separation
    let cursor_x = main_x[0]
    let cursor_y = main_y[1] + gap_y
    let row_height = 0

    component_layouts.forEach(component => {
      if (cursor_x > main_x[0] && cursor_x + component.width > main_x[0] + row_width) {
        cursor_x = main_x[0]
        cursor_y += row_height + gap_y
        row_height = 0
      }
      let dx = cursor_x - component.min_x + node_separation / 2
      let dy = cursor_y - component.min_y + level_separation / 2
      const anchored_node = component.anchor && component.nodes.find(d => d.data.id === component.anchor!.person_id)
      const related_node = component.anchor && tree.find(d => d.data.id === component.anchor!.relative_id)
      if (component.anchor && anchored_node && related_node) {
        const direction = component.anchor.kind === "parents" ? 1 : component.anchor.kind === "children" ? -1 : 0
        if (is_horizontal) {
          const desired_x = related_node.x + direction * level_separation
          const occupied = tree.filter(d => Math.abs(d.x - desired_x) < level_separation / 2)
          const desired_y = (occupied.length ? Math.max(...occupied.map(d => d.y)) : related_node.y) + node_separation
          dx = desired_x - anchored_node.x
          dy = desired_y - anchored_node.y
        } else {
          const desired_y = related_node.y + direction * level_separation
          const occupied = tree.filter(d => Math.abs(d.y - desired_y) < level_separation / 2)
          const desired_x = (occupied.length ? Math.max(...occupied.map(d => d.x)) : related_node.x) + node_separation
          dx = desired_x - anchored_node.x
          dy = desired_y - anchored_node.y
        }
      }
      component.nodes.forEach(d => {
        shift(d, "x", dx); shift(d, "sx", dx); shift(d, "psx", dx)
        shift(d, "y", dy); shift(d, "sy", dy); shift(d, "psy", dy)
        tree.push(d)
      })
      if (!component.anchor) {
        cursor_x += component.width + gap_x
        row_height = Math.max(row_height, component.height)
      }
    })
    data_stash.forEach(d => d.main = d.id === main_id)  // recursive mini-layouts temporarily set their own roots as main

    function shift(d:TreeDatum, key:"x"|"y"|"sx"|"sy"|"psx"|"psy", amount:number) {
      if (typeof d[key] === "number") d[key] = d[key]! + amount
    }
  }

  function calculateTreeDim(tree:TreeDatum[], node_separation:number, level_separation:number) {
    if (is_horizontal) [node_separation, level_separation] = [level_separation, node_separation]
    const w_extent = d3.extent(tree, (d:TreeDatum) => d.x)
    const h_extent = d3.extent(tree, (d:TreeDatum) => d.y)
    if (w_extent[0] === undefined || w_extent[1] === undefined || h_extent[0] === undefined || h_extent[1] === undefined) throw new Error('No extent')
    return {
      width: w_extent[1] - w_extent[0]+node_separation, height: h_extent[1] - h_extent[0]+level_separation, x_off: -w_extent[0]+node_separation/2, y_off: -h_extent[0]+level_separation/2
    }
  }

  function createRelsToAdd(data:Data) {
    const to_add_spouses:Datum[] = [];
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      if (d.rels.children && d.rels.children.length > 0) {
        if (!d.rels.spouses) d.rels.spouses = []
        let to_add_spouse:Datum | undefined

        d.rels.children.forEach(d0 => {
          const child = data.find(d1 => d1.id === d0) as Datum
          if (child.rels.parents.length === 2) return
          if (!to_add_spouse) {
            to_add_spouse = findOrCreateToAddSpouse(d)
          }
          if (!to_add_spouse.rels.children) to_add_spouse.rels.children = []
          to_add_spouse.rels.children.push(child.id)
          if (child.rels.parents.length !== 1) throw new Error('child has more than 1 parent')
          child.rels.parents.push(to_add_spouse.id)
        })
      }
    }
    to_add_spouses.forEach(d => data.push(d))
    return data

    function findOrCreateToAddSpouse(d:Datum) {
      const spouses = (d.rels.spouses || []).map(sp_id => data.find(d0 => d0.id === sp_id)).filter(d => d !== undefined)
      return spouses.find(sp => sp.to_add) || createToAddSpouse(d)
    }

    function createToAddSpouse(d:Datum) {
      const spouse = createNewPerson({
        data: {gender: d.data.gender === "M" ? "F" : "M"},
        rels: {spouses: [d.id]}
      }) as Datum
      spouse.to_add = true;
      to_add_spouses.push(spouse);
      if (!d.rels.spouses) d.rels.spouses = []
      d.rels.spouses.push(spouse.id)
      return spouse
    }
  }

  function trimTree(root:HN, is_ancestry:boolean) {
    let max_depth = is_ancestry ? ancestry_depth : progeny_depth
    if (one_level_rels) max_depth = 1
    if (!max_depth && max_depth !== 0) return root

    trimNode(root, 0)

    return root

    function trimNode(node:HN, depth:number) {
      if (depth === max_depth) {
        if (node.children) delete node.children
      } else if (node.children) {
        node.children.forEach(child => {
          trimNode(child, depth+1)
        })
      }
    }
  }
  
  function handleDuplicateHierarchy(root:HN, data_stash:Data, is_ancestry:boolean) {
    if (is_ancestry) handleDuplicateHierarchyAncestry(root, on_toggle_one_close_others)
    else handleDuplicateHierarchyProgeny(root, data_stash, on_toggle_one_close_others)
  }
}

/** BFS over parents/spouses/children from `start_id` across the whole data set, ignoring the current ego-centric view. */
function getReachableIds(start_id:string, data_stash:Data) {
  const visited = new Set<string>()  // ids confirmed reachable so far; also doubles as the "already queued" check
  const queue = [start_id]  // ids still to visit, seeded with main
  while (queue.length) {
    const id = queue.pop() as string  // take the next id to visit (order doesn't matter for reachability)
    if (visited.has(id)) continue  // already handled via a different path, skip
    visited.add(id)
    const d = data_stash.find(d0 => d0.id === id)  // look up the actual record for this id
    if (!d) continue  // id referenced in someone's rels but no longer in the data (e.g. deleted), nothing to walk from it
    const neighbors = [...(d.rels.parents || []), ...(d.rels.spouses || []), ...(d.rels.children || [])]  // everyone directly related to this person, in any direction
    neighbors.forEach(n => { if (n && !visited.has(n)) queue.push(n) })  // queue up anyone not already visited
  }
  return visited  // every id transitively reachable from start_id
}

function setupTid(tree:TreeDatum[]) {
  const ids:string[] = []
  tree.forEach(d => {
    if (ids.includes(d.data.id)) {
      const duplicates = tree.filter(d0 => d0.data.id === d.data.id)
      duplicates.forEach((d0, i) => {
        d0.tid = `${d.data.id}--x${i+1}`
        d0.duplicate = duplicates.length
        ids.push(d.data.id)
      })
    } else {
      d.tid = d.data.id
      ids.push(d.data.id)
    }
  })
}


/** 
 * Calculate the tree
 * @param options - The options for the tree
 * @param options.data - The data for the tree
 * @returns The tree
 * @deprecated Use f3.calculateTree instead
 */
export function CalculateTree(options: CalculateTreeOptions & {data: Data}) {
  return calculateTreeWithV1Data(options.data, options)
}

import { formatData } from "../store/format-data";
import { LegacyDatum } from "../store/format-data";

/**
 * Calculate the tree with v1 data
 * @param data - The data for the tree
 * @param options - The options for the tree
 * @returns The tree
 */

export function calculateTreeWithV1Data(data: LegacyDatum[], options: CalculateTreeOptions) {
  const formatted_data = formatData(data);
  return calculateTree(formatted_data, options)
}