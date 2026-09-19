import * as d3 from "d3"
import {createLinks} from "../layout/create-links"
import {calculateDelay} from "../handlers/general"
import { ViewProps } from "./view"
import { Tree } from "../layout/calculate-tree"
import { Link } from "../layout/create-links"
import { LinkSelection } from "../types/view"

export default function updateLinks(svg: SVGElement, tree: Tree, props: ViewProps = {}) {
  const links_data_dct = tree.data.reduce((acc: Record<string, Link>, d) => {
    createLinks(d, tree.is_horizontal).forEach(l => acc[l.id] = l)
    return acc
  }, {})
  const links_data: Link[] = [...Object.values(links_data_dct), ...createUnconfirmedLinks(tree)]
  const link: LinkSelection = d3
    .select(svg)
    .select(".links_view")
    .selectAll<SVGPathElement, Link>("path.link")
    .data(links_data, d => d.id)

  if (props.transition_time === undefined) throw new Error('transition_time is undefined')
  const link_exit = link.exit();
  const link_enter = link.enter().append("path").attr("class", "link");
  const link_update = link_enter.merge(link);

  link_exit.each(linkExit)
  link_enter.each(linkEnter)
  link_update.each(linkUpdate)

  function linkEnter(this: SVGPathElement, d: Link) {
    d3.select(this).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1).style("opacity", 0)
      .attr("d", createPath(d, true))
  }

  function linkUpdate(this: SVGPathElement, d: Link) {
    const path = d3.select(this).classed("link-unconfirmed", !!d.unconfirmed);
    const delay = props.initial ? calculateDelay(tree, d, props.transition_time!) : 0
    path.transition('path').duration(props.transition_time!).delay(delay).attr("d", createPath(d)).style("opacity", 1)
  }

  function linkExit(this: SVGPathElement, d: unknown | Link) {
    const path = d3.select(this);
    path.transition('op').duration(800).style("opacity", 0)
    path.transition('path').duration(props.transition_time!).attr("d", createPath(d as Link, true))
      .on("end", () => path.remove())
  }

}

function createPath(d: Link, is_: boolean = false) {
  const line = d3.line().curve(d3.curveMonotoneY)
  const lineCurve = d3.line().curve(d3.curveBasis)
  const path_data: [number, number][] = is_ ? d._d() : d.d

  if (!d.curve) return line(path_data)
  else return lineCurve(path_data)
}

function createUnconfirmedLinks(tree: Tree): Link[] {
  const visible = new Map<string, Tree["data"][number]>()
  tree.data.forEach(d => { if (!visible.has(d.data.id)) visible.set(d.data.id, d) })
  const seen = new Set<string>()
  const links: Link[] = []

  tree.data_stash.forEach(person => {
    const relations = person.unconfirmed_rels || {}
    ;(["parents", "spouses", "children"] as const).forEach(kind => {
      ;(relations[kind] || []).forEach(relative_id => {
        const key = [person.id, relative_id].sort().join("--")
        if (seen.has(key)) return
        seen.add(key)
        const source = visible.get(person.id)
        const target = visible.get(relative_id)
        if (!source || !target) return
        const mid = tree.is_horizontal ? (source.x + target.x) / 2 : (source.y + target.y) / 2
        const points = tree.is_horizontal
          ? [[source.x, source.y], [mid, source.y], [mid, target.y], [target.x, target.y]]
          : [[source.x, source.y], [source.x, mid], [target.x, mid], [target.x, target.y]]
        links.push({
          d: points as [number, number][],
          _d: () => [[source.x, source.y], [source.x, source.y]],
          curve: false,
          id: `unconfirmed--${key}`,
          depth: 0,
          is_ancestry: false,
          source,
          target,
          unconfirmed: true,
        })
      })
    })
  })
  return links
}
