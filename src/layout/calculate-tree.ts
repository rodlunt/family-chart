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
          // Keep the person centered and fan spouses to alternating sides (1st
          // spouse one side, 2nd the other, 3rd further out on the 1st's side,
          // etc.), then recenter the whole cluster on the person's original x.
          // With a single spouse this is just the couple centered on the
          // person's slot. With two or more, this is what keeps each spouse's
          // own children descending from between the right pair, instead of
          // the person's OTHER spouse's row visually passing through whichever
          // spouse got stacked in the middle (e.g. two spouses with the person
          // sandwiched used to put spouse 2 between the person and spouse 1).
          const base_x = d.x
          const offsets = spouses.map((_sp_id, i) => {
            const dir = i % 2 === 0 ? 1 : -1
            const dist = Math.floor(i / 2) + 1  // 1,1,2,2,3,3...
            return node_separation * dist * dir
          })
          const center = offsets.reduce((a, b) => a + b, 0) / (offsets.length + 1)  // mean over person (0) + every spouse offset
          d.x = base_x - center
          spouses.forEach((sp_id, i) => {
            const spouse:TreeDatum = {
              data: data_stash.find(d0 => d0.id === sp_id) as Datum,
              added: true,
              depth: d.depth,
              spouse: d,
              x: base_x + offsets[i] - center,
              y: d.y,
              tid: `${d.data.id}-spouse-${i}`,
            }
            const toward = spouse.x < d.x ? 1 : -1  // anchor the couple link at the midpoint, toward the person
            spouse.sx = spouse.x + toward * (node_separation / 2)
            spouse.sy = spouse.y
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
    const displayed_ids = new Set(tree.map(d => d.data.id))  // everyone already rendered in main's ego-centric window
    const confirmed_reachable_ids = getReachableIds(main_id, data_stash)  // everyone genuinely linked to main by real (not just unconfirmed) rels, anywhere in the data
    const supplemental_ids = new Set(data_stash.filter(d => !displayed_ids.has(d.id)).map(d => d.id))  // everyone not already on screen, confirmed-connected or not
    const components:Data[] = []  // each entry is one connected group of supplemental people, laid out as its own mini-tree
    const visited = new Set<string>()  // ids already assigned to a component, so no one is placed twice

    data_stash.filter(d => supplemental_ids.has(d.id) && !d.to_add).forEach(seed => {
      if (visited.has(seed.id)) return  // already grouped via an earlier seed in this same component
      const component_ids = getReachableWithin(seed.id, supplemental_ids)  // this seed's whole connected group, restricted to other supplemental people
      const component = data_stash.filter(d => component_ids.has(d.id))
      component.forEach(d => visited.add(d.id))
      components.push(component)
    })
    if (!components.length) return  // nothing supplemental to place, don't touch tree/dim

    // BFS restricted to `allowed`, so a supplemental person's component never pulls in
    // someone already displayed in the main hierarchy (that person gets a full graph
    // walk of their own via getReachableIds, not a component here).
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

    // Every relation kind checked when looking for a reason to anchor a component to the displayed tree.
    const REL_KINDS = ["parents", "spouses", "children"] as const
    type RelKind = typeof REL_KINDS[number]
    type Anchor = {person_id:string, relative_id:string, kind:RelKind}

    // Finds the first relation (of the given rels map) from someone in `component` to someone
    // already displayed. Written as a plain loop rather than component.flatMap(...) because a
    // readonly tuple's .flatMap isn't recognised under this project's `target: es2015`
    // tsconfig (same root cause as the pre-existing `.includes()` warnings elsewhere in this
    // file) - a loop sidesteps that entirely instead of just tolerating another warning.
    function findAnchor(component:Data, getRels:(person:Datum) => Partial<Record<RelKind, string[]>>):Anchor | undefined {
      for (const person of component) {
        const relations = getRels(person)
        for (const kind of REL_KINDS) {
          for (const relative_id of relations[kind] || []) {
            if (displayed_ids.has(relative_id)) return {person_id: person.id, relative_id, kind}
          }
        }
      }
      return undefined
    }

    const component_layouts = components.map(component => {
      const component_ids = new Set(component.map(d => d.id))  // ids belonging to this one component only
      const layout_component = component.map(d => ({
        ...d,
        data: {...d.data},
        rels: {
          // drop any rels pointing outside this component (into another mini-tree or the
          // main hierarchy) so the nested calculateTree call below only ever sees a single,
          // fully self-contained family to lay out
          parents: (d.rels.parents || []).filter(id => component_ids.has(id)),
          spouses: (d.rels.spouses || []).filter(id => component_ids.has(id)),
          children: (d.rels.children || []).filter(id => component_ids.has(id)),
        },
      })) as Data  // isolate layout from relatives represented in another mini-tree or the focused hierarchy
      const real_people = layout_component.filter(d => !d.to_add)  // exclude the library's own auto-generated spouse placeholders from root selection
      const roots = real_people.filter(d => !(d.rels.parents || []).some(id => component_ids.has(id)))  // people with no parent inside this component are candidate roots
      const root = roots.sort((a, b) => (b.rels.children || []).length - (a.rels.children || []).length)[0] || real_people[0]  // prefer whoever has the most children, so the component reads top-down
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
        // `component`'s membership was found by a fully transitive walk over parents+spouses+
        // children (getReachableWithin), but this nested calculateTree's own ego-centric layout
        // from a single `root` only reaches root's blood ancestors/descendants plus each of
        // their DIRECT spouses - it never walks into a spouse's own parents or siblings. A person
        // connected to the component only through such a link (e.g. an unconfirmed ancestor whose
        // sole tie to the rest of the family is being an in-law's parent) is a real member of
        // `component` that this single-root walk can never reach, and used to be silently absent
        // from `component_tree` below - which then made the *anchor* lookup a few lines down
        // fail and the whole branch get dropped (see the anchored_node/related_node guard).
        // Recursing here closes that gap: it's bounded, since `layout_component` is already a
        // strict subset of the outer call's data, and each further nested "unconnected" group is
        // a strictly smaller subset again, so this can't run away.
        show_unconnected: true,
      }).data

      component_tree.forEach(d => {
        d.data = data_stash.find(original => original.id === d.data.id) || d.data  // editing must target the real store record, not the isolated layout clone
        d.floating = !confirmed_reachable_ids.has(d.data.id)  // provisional; cleared below if this whole component turns out to be anchored
      })
      const x_extent = d3.extent(component_tree, d => d.x) as [number, number]  // this component's own [min x, max x], before it's shifted into place
      const y_extent = d3.extent(component_tree, d => d.y) as [number, number]  // this component's own [min y, max y], before it's shifted into place
      // A confirmed rels link to the displayed tree takes priority over a merely-suspected one:
      // if both exist, anchor on the relationship we actually believe.
      const anchor = findAnchor(component, (person) => person.rels) || findAnchor(component, (person) => person.unconfirmed_rels || {})
      if (anchor) component_tree.forEach(d => d.floating = false)  // anchored means genuinely placed next to a real relative, not merely floating nearby
      return {
        nodes: component_tree,
        min_x: x_extent[0],
        min_y: y_extent[0],
        width: x_extent[1] - x_extent[0] + node_separation,
        height: y_extent[1] - y_extent[0] + level_separation,
        anchor,
      }
    })

    const anchored_components = component_layouts.filter(component => component.anchor)  // has a real (confirmed or unconfirmed) link to someone displayed
    const unanchored_components = component_layouts.filter(component => !component.anchor)  // genuinely floating, no known relationship to the displayed tree at all

    // Place connected collateral branches first. Align each branch with its relationship anchor,
    // then move the complete branch sideways until every generation in its footprint is clear.
    anchored_components.forEach(component => {
      const anchored_node = component.nodes.find(d => d.data.id === component.anchor!.person_id)  // the component's own person named in the anchor
      const related_node = tree.find(d => d.data.id === component.anchor!.relative_id)  // their counterpart, already placed in the displayed tree
      if (!anchored_node || !related_node) {
        // Should be unreachable now that the nested calculateTree call above recurses with its
        // own show_unconnected pass (every member of `component` is guaranteed a place in
        // component.nodes, anchored or floating, same invariant this function itself provides
        // at the top level). If this still fires, some component member genuinely has no node -
        // surface it loudly rather than silently dropping the whole branch the way this used to.
        console.error('placeUnconnected: anchor node missing from its own component, dropping this branch instead of placing it', {anchor: component.anchor, anchored_node_found: !!anchored_node, related_node_found: !!related_node, component_node_ids: component.nodes.map(d => d.data.id)})
        return
      }
      const direction = component.anchor!.kind === "parents" ? 1 : component.anchor!.kind === "children" ? -1 : 0  // parents render above (+1 generation), children below (-1), spouses level (0)
      const base_dx = is_horizontal
        ? related_node.x + direction * level_separation - anchored_node.x
        : related_node.x - anchored_node.x  // vertical layout: align horizontally with the related node
      const dy = is_horizontal
        ? related_node.y - anchored_node.y  // horizontal layout: align vertically with the related node
        : related_node.y + direction * level_separation - anchored_node.y
      const dx = nearestCollisionFreeShift(component.nodes, base_dx, dy)  // base_dx is the ideal alignment; nudge sideways only as far as needed to clear a collision
      appendShifted(component.nodes, dx, dy)
    })

    // Truly disconnected groups belong after the connected tree, packed into compact rows.
    const placed_x = d3.extent(tree, d => d.x) as [number, number]  // bounding box of everything placed so far: the main tree plus any anchored branches
    const placed_y = d3.extent(tree, d => d.y) as [number, number]
    const placed_width = placed_x[1] - placed_x[0] + node_separation
    const total_area = unanchored_components.reduce((sum, component) => sum + component.width * component.height, 0)  // rough total footprint of everything still to place
    const widest_component = Math.max(0, ...unanchored_components.map(component => component.width))  // 0 floor: Math.max() of an empty array is -Infinity
    const row_width = Math.max(placed_width, widest_component, Math.sqrt(total_area) * 1.5)  // wide enough to roughly match the tree above, never narrower than the widest single component
    const gap_x = node_separation * .5  // tighter than a normal card gap: these are compact rows, not a generation of the tree
    const gap_y = level_separation
    let cursor_x = placed_x[0]  // next free x position for a component in the current row
    let cursor_y = placed_y[1] + gap_y  // first row starts one gap below the lowest placed card
    let row_height = 0  // tallest component seen in the current row, so the next row starts clear of all of them

    unanchored_components.forEach(component => {
      if (cursor_x > placed_x[0] && cursor_x + component.width > placed_x[0] + row_width) {
        cursor_x = placed_x[0]  // this component doesn't fit on the current row, wrap to a new one
        cursor_y += row_height + gap_y
        row_height = 0
      }
      const dx = cursor_x - component.min_x + node_separation / 2  // shift so the component's own left edge lands at cursor_x
      const dy = cursor_y - component.min_y + level_separation / 2  // shift so the component's own top edge lands at cursor_y
      appendShifted(component.nodes, dx, dy)
      cursor_x += component.width + gap_x  // advance past this component for the next one in the row
      row_height = Math.max(row_height, component.height)
    })

    // Searches outward from base_dx in both directions, in half-card steps, for the nearest
    // offset where no node in `nodes` lands in the same generation row as, and too close to,
    // an already-placed node. Throws rather than silently overlapping if nothing within 200
    // steps works, since a silently overlapping tree is worse than a visible error.
    function nearestCollisionFreeShift(nodes:TreeDatum[], base_dx:number, dy:number) {
      const step = node_separation / 2
      for (let distance = 0; distance < 200; distance++) {
        const offsets = distance === 0 ? [0] : [distance * step, -distance * step]  // try the ideal position first, then alternate left/right around it
        for (const offset of offsets) {
          const dx = base_dx + offset
          const collides = nodes.some(candidate => tree.some(placed => {
            const same_generation = is_horizontal
              ? Math.abs(candidate.x + dx - placed.x) < level_separation / 2  // horizontal layout: generations run along x
              : Math.abs(candidate.y + dy - placed.y) < level_separation / 2  // vertical layout: generations run along y
            const centres_too_close = is_horizontal
              ? Math.abs(candidate.y + dy - placed.y) < node_separation
              : Math.abs(candidate.x + dx - placed.x) < node_separation
            return same_generation && centres_too_close  // only a collision if it's both the same row AND too close along that row
          }))
          if (!collides) return dx
        }
      }
      throw new Error("Unable to place supplemental family branch without overlap")
    }

    function appendShifted(nodes:TreeDatum[], dx:number, dy:number) {
      nodes.forEach(d => {
        shift(d, "x", dx); shift(d, "sx", dx); shift(d, "psx", dx)  // sx/psx are spouse/parent-spouse x offsets used for drawing link lines; must move with the card
        shift(d, "y", dy); shift(d, "sy", dy); shift(d, "psy", dy)
        tree.push(d)  // this is what actually adds the (now correctly positioned) node to the tree that gets rendered
      })
    }
    data_stash.forEach(d => d.main = d.id === main_id)  // recursive mini-layouts temporarily set their own roots as main

    function shift(d:TreeDatum, key:"x"|"y"|"sx"|"sy"|"psx"|"psy", amount:number) {
      if (typeof d[key] === "number") d[key] = d[key]! + amount  // sx/sy/psx/psy are only set on some nodes (spouses, progeny); leave the rest untouched
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