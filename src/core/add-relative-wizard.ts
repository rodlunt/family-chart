import * as d3 from "d3"
import { Modal } from "../features/modal"
import { Store } from "../types/store"
import { Datum } from "../types/data"
import { AddRelative } from "./add-relative"
import { FormCreatorSetupProps } from "../types/form"
import { AddRelativeType, cleanUp, getAddRelativeAvailability, createSingleRelPlaceholder } from "../store/add-relative"
import { getLinkRelOptions } from "../store/add-existing-rel"

/**
 * Relationship-first add-relative wizard, built on the shared `Modal` (the same instance
 * `EditTree` uses for the edit form when `setEditFormDisplay('modal')` is active, and that
 * `RemoveRelative` uses for its own confirmation dialog). Two steps:
 *
 *  1. Pick a relationship type - Parent / Spouse / Child - filtered by `canAdd`, with a
 *     father-vs-mother or son-vs-daughter sub-step where both options are actually open.
 *  2. Create a new person, or link one of the existing people `getLinkRelOptions` allows.
 *
 * Exactly one placeholder person is created, at the point the relationship type resolves
 * (step 1 -> step 2), via `createSingleRelPlaceholder`. Backing out of step 2, or dismissing
 * the modal at any point (close button, backdrop click, Escape), cleans that placeholder back
 * out via the existing `cleanUp` used by add-relative's own cancel path.
 */
export function runAddRelativeWizard({
  modal,
  store,
  datum,
  addRelLabels,
  canAdd,
  getLinkExistingRelConfig,
  onCreateNew,
  onLinkExisting,
  onCancel,
}: {
  modal: Modal
  store: Store
  datum: Datum
  addRelLabels: AddRelative['addRelLabels']
  canAdd: AddRelative['canAdd']
  getLinkExistingRelConfig: () => FormCreatorSetupProps['link_existing_rel_config']
  onCreateNew: (placeholder: Datum) => void
  onLinkExisting: (placeholder: Datum, link_rel_id: Datum['id']) => void
  onCancel: () => void
}) {
  showStep1()

  function showStep(content: HTMLElement) {
    modal.activate(content)
    modal.onClose = onCancel
  }

  // Runs `action` (opening the placeholder's edit form, or committing a link) after quietly
  // closing the wizard's own modal step - "quietly" because a plain modal.close() would
  // otherwise fire modal.onClose, which is wired to onCancel() and would wrongly clean up the
  // placeholder this wizard run just successfully resolved.
  function resolve(action: () => void) {
    modal.onClose = null
    modal.close()
    action()
  }

  function showStep1() {
    const availability = getAddRelativeAvailability(datum, store.getData(), canAdd)
    const div = d3.create('div').attr('class', 'f3-add-relative-wizard').html(`
      <h3 class="f3-form-title">Add relative</h3>
      <div class="f3-wizard-options"></div>
    `)
    const options = div.select('.f3-wizard-options')
    if (availability.parent) options.append('button').attr('type', 'button').attr('class', 'f3-btn').text('Parent').on('click', showParentSubStep)
    if (availability.spouse) options.append('button').attr('type', 'button').attr('class', 'f3-btn').text('Spouse').on('click', () => resolveRelType('spouse'))
    if (availability.child) options.append('button').attr('type', 'button').attr('class', 'f3-btn').text('Child').on('click', showChildSubStep)
    if (!availability.parent && !availability.spouse && !availability.child) {
      options.append('p').text('No further relatives can be added here.')
    }
    showStep(div.node()!)

    function showParentSubStep() {
      if (availability.father_open && availability.mother_open) {
        showSubStep('Add parent', [
          {label: 'Father', class: 'f3-male-bg', rel_type: 'father' as AddRelativeType},
          {label: 'Mother', class: 'f3-female-bg', rel_type: 'mother' as AddRelativeType},
        ])
      } else if (availability.father_open) {
        resolveRelType('father')
      } else {
        resolveRelType('mother')
      }
    }

    function showChildSubStep() {
      showSubStep('Add child', [
        {label: 'Son', class: 'f3-male-bg', rel_type: 'son' as AddRelativeType},
        {label: 'Daughter', class: 'f3-female-bg', rel_type: 'daughter' as AddRelativeType},
      ])
    }

    function showSubStep(title: string, choices: {label: string, class: string, rel_type: AddRelativeType}[]) {
      const sub = d3.create('div').attr('class', 'f3-add-relative-wizard').html(`
        <h3 class="f3-form-title">${title}</h3>
        <div class="f3-wizard-options"></div>
      `)
      const sub_options = sub.select('.f3-wizard-options')
      choices.forEach(choice => {
        sub_options.append('button')
          .attr('type', 'button')
          .attr('class', `f3-btn ${choice.class}`)
          .text(choice.label)
          .on('click', () => resolveRelType(choice.rel_type))
      })
      sub.append('button').attr('type', 'button').attr('class', 'f3-wizard-back').text('Back').on('click', showStep1)
      showStep(sub.node()!)
    }
  }

  function resolveRelType(rel_type: AddRelativeType) {
    const placeholder = createSingleRelPlaceholder(datum, store.getData(), rel_type, addRelLabels)
    store.updateTree({})
    showStep2(placeholder)
  }

  function showStep2(placeholder: Datum) {
    const link_existing_rel_config = getLinkExistingRelConfig()
    const label = placeholder._new_rel_data?.label || 'Add relative'
    const div = d3.create('div').attr('class', 'f3-add-relative-wizard').html(`
      <h3 class="f3-form-title">${label}</h3>
      <div class="f3-wizard-options">
        <button type="button" class="f3-btn f3-wizard-create-new">Create a new person</button>
      </div>
    `)
    div.select('.f3-wizard-create-new').on('click', () => resolve(() => onCreateNew(placeholder)))

    if (link_existing_rel_config) {
      const options = getLinkRelOptions(placeholder, store.getData())
        .map((d: Datum) => ({value: d.id, label: link_existing_rel_config.linkRelLabel(d)}))
        .sort((a: {label: string}, b: {label: string}) => {
          if (typeof a.label === 'string' && typeof b.label === 'string') return a.label.localeCompare(b.label)
          else return a.label < b.label ? -1 : 1
        })

      const link_cont = div.append('div').attr('class', 'f3-link-existing-relative').html(`
        <hr>
        <label>${link_existing_rel_config.title ?? 'Profile already exists?'}</label>
        <select>
          <option value="">${link_existing_rel_config.select_placeholder ?? 'Select profile'}</option>
          ${options.map(option => `<option value="${option.value}">${option.label}</option>`).join('')}
        </select>
      `)
      link_cont.select('select').on('change', (event: Event) => {
        const link_rel_id = (event.target as HTMLSelectElement).value
        if (!link_rel_id) return
        resolve(() => onLinkExisting(placeholder, link_rel_id))
      })
    }

    div.append('button').attr('type', 'button').attr('class', 'f3-wizard-back').text('Back').on('click', () => {
      cleanUp(store.getData())
      store.updateTree({})
      showStep1()
    })

    showStep(div.node()!)
  }
}
