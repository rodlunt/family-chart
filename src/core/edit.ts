import * as d3 from "d3"
import { formCreatorSetup } from "./form-creator"
import { createHistory, createHistoryControls, HistoryWithControls } from "../features/history"
import { createFormEdit, createFormNew } from "../renderers/create-form"
import addRelative from "./add-relative"
import { deletePerson, cleanupDataJson } from "../store/edit"
import { handleLinkRel } from "../store/add-existing-rel"
import removeRelative, { RemoveRelative } from "./remove-relative"
import modal, { Modal } from "../features/modal"

import { Store } from "../types/store"
import { Data, Datum } from "../types/data"
import { TreeDatum } from "../types/treeData"
import { AddRelative } from "./add-relative"
import { EditDatumFormCreator, FormCreator, FormCreatorSetupProps, NewRelFormCreator } from "../types/form"
import { CardHtml } from "./cards/card-html"
import { CardSvg } from "./cards/card-svg"
import { LegacyDatum, formatDataForExport } from "../store/format-data"

type Card = CardHtml | CardSvg


export default (cont: HTMLElement, store: Store) => new EditTree(cont, store)

/**
 * EditTree class - Provides comprehensive editing capabilities for family tree data.
 * 
 * This class handles all editing operations for family tree data, including:
 * - Adding new family members and relationships
 * - Editing existing person information
 * - Removing family members and relationships
 * - Form management and validation
 * - History tracking and undo/redo functionality
 * - Modal dialogs and user interactions
 * 
 * @example
 * ```typescript
 * import * as f3 from 'family-chart'
 * const f3Chart = f3.createChart('#FamilyChart', data)
 * const f3EditTree = f3Chart.editTree()  // returns an EditTree instance
 *   .setFields(["first name","last name","birthday"])
 *   .setOnChange(() => {
 *      const updated_data = f3EditTree.exportData()
 *      // do something with the updated data
 *   })
 * ```
 */
export class EditTree {
  cont: HTMLElement
  store: Store
  fields: {type: string, label: string, id: string}[]
  formCont: {
    el?: HTMLElement,
    populate: (form_element: HTMLElement) => void,
    open: () => void,
    close: () => void,
  }
  is_fixed: boolean
  no_edit: boolean
  onChange: (() => void) | null
  editFirst: boolean
  postSubmit: ((datum: Datum, data: Data) => void) | null
  link_existing_rel_config?: FormCreatorSetupProps['link_existing_rel_config']
  onFormCreation: null | ((props: {cont: HTMLElement, form_creator: FormCreator}) => void)
  upload_handler: FormCreatorSetupProps['uploadFile'] | null

  addRelativeInstance: AddRelative
  removeRelativeInstance: RemoveRelative
  history: HistoryWithControls
  modal: Modal

  createFormEdit: ((form_creator: FormCreator, closeCallback: () => void) => HTMLElement) | null
  createFormNew: ((form_creator: FormCreator, closeCallback: () => void) => HTMLElement) | null

  onSubmit: FormCreatorSetupProps['onSubmit']
  onDelete: FormCreatorSetupProps['onDelete']
  canEdit: FormCreatorSetupProps['canEdit']
  canDelete: FormCreatorSetupProps['canDelete']
  
  constructor(cont: HTMLElement, store: Store) {
    this.cont = cont
    this.store = store
  
    this.fields = [
      {type: 'text', label: 'first name', id: 'first name'},
      {type: 'text', label: 'last name', id: 'last name'},
      {type: 'text', label: 'birthday', id: 'birthday'},
      {type: 'text', label: 'avatar', id: 'avatar'}
    ]
  
    this.is_fixed = true
  
    this.no_edit = false
  
    this.onChange = null
  
    this.editFirst = false
  
    this.postSubmit = null
    
    this.onFormCreation = null

    this.upload_handler = null

    this.createFormEdit = null
    this.createFormNew = null
  
    this.formCont = this.getFormContDefault()
    this.modal = this.setupModal()
    this.addRelativeInstance = this.setupAddRelative()
    this.removeRelativeInstance = this.setupRemoveRelative()
    this.history = this.createHistory()
  
    return this 
  }

  /**
   * Open the edit form
   * @param datum - The datum to edit
   */
  open(datum: Datum) {
    if (!datum.rels) datum = datum.data as unknown as Datum  // if TreeDatum is used, it will be converted to Datum. will be removed in a future version.
    if (this.addRelativeInstance.is_active) handleAddRelative(this)
    else if (this.removeRelativeInstance.is_active) handleRemoveRelative(this, this.store.getTreeDatum(datum.id))
    else {
      this.cardEditForm(datum)
    }
  
    function handleAddRelative(self: EditTree) {
      if (datum._new_rel_data) {
        self.cardEditForm(datum)
      } else {
        self.addRelativeInstance.onCancel!()
        self.cardEditForm(datum)
        self.store.updateMainId(datum.id)
        self.store.updateTree({})
      }
    }
  
    function handleRemoveRelative(self: EditTree, tree_datum: TreeDatum | undefined) {
      if (!tree_datum) throw new Error('Tree datum not found')
      if (!self.removeRelativeInstance.datum) throw new Error('Remove relative datum not found')
      if (!self.removeRelativeInstance.onCancel) throw new Error('Remove relative onCancel not found')
      if (!self.removeRelativeInstance.onChange) throw new Error('Remove relative onChange not found')

      if (datum.id === self.removeRelativeInstance.datum.id) {
        self.removeRelativeInstance.onCancel()
        self.cardEditForm(datum)
      } else {
        self.removeRelativeInstance.onChange(tree_datum, onAccept.bind(self))
  
        function onAccept() {
          self.removeRelativeInstance.onCancel!()
          self.updateHistory()
          self.store.updateTree({})
        }
      }
    }
  }

  private setupAddRelative() {
    return addRelative(
      this.store,
      () => onActivate(this),
      (datum: Datum) => cancelCallback(this, datum),
      this.modal,
      () => this.link_existing_rel_config,
      (placeholder: Datum, resolution) => onResolved(this, placeholder, resolution),
    )

    function onActivate(self: EditTree) {
      if (self.removeRelativeInstance.is_active) self.removeRelativeInstance.onCancel!()
    }

    function cancelCallback(self: EditTree, datum: Datum) {
      self.store.updateMainId(datum.id)
      self.store.updateTree({})
      self.openFormWithId(datum.id)
    }

    // Called once the add-relative wizard resolves a relationship choice: either the user
    // wants to fill in a brand new person (open that placeholder's own edit form, with the
    // "link to existing person" dropdown suppressed since that choice was already made
    // explicitly by picking "create new" in the wizard), or they picked an existing person to
    // link straight away (no form needed - same data path as picking one from that dropdown).
    function onResolved(self: EditTree, placeholder: Datum, resolution: {type: 'create'} | {type: 'link', link_rel_id: Datum['id']}) {
      if (resolution.type === 'create') {
        self.cardEditForm(placeholder, {suppressLinkExisting: true})
      } else {
        self.finishAddRelative(placeholder, {link_rel_id: resolution.link_rel_id})
      }
    }
  }
  
  private setupRemoveRelative() {
    return removeRelative(this.store, onActivate.bind(this), cancelCallback.bind(this), this.modal)
  
    function onActivate(this: EditTree) {
      if (this.addRelativeInstance.is_active) this.addRelativeInstance.onCancel!()
      setClass(this.cont, true)
    }
  
    function cancelCallback(this: EditTree, datum: Datum) {
      setClass(this.cont, false)
      this.store.updateMainId(datum.id)
      this.store.updateTree({})
      this.openFormWithId(datum.id)
    }
  
    function setClass(cont: HTMLElement, add: boolean) {
      d3.select(cont).select('#f3Canvas').classed('f3-remove-relative-active', add)
    }
  }

  private createHistory() {
    const history = createHistory(this.store, this._getStoreDataCopy.bind(this), historyUpdateTree.bind(this))

    const nav_cont = this.cont.querySelector('.f3-nav-cont') as HTMLElement
    if (!nav_cont) throw new Error("Nav cont not found")
    const controls = createHistoryControls(nav_cont, history)

    history.changed()
    controls.updateButtons()
  
    return {...history, controls}
  
    function historyUpdateTree(this: EditTree) {
      console.log('historyUpdateTree')
      if (this.addRelativeInstance.is_active) this.addRelativeInstance.onCancel!()
      if (this.removeRelativeInstance.is_active) this.removeRelativeInstance.onCancel!()
      this.store.updateTree({initial: false})
      this.history.controls.updateButtons()
      this.openFormWithId(this.store.getMainDatum()?.id)
      if (this.onChange) this.onChange()
    }
  }
  
  /**
   * Open the edit form without canceling the add relative or remove relative view
   * @param datum - The datum to edit
   */
  openWithoutRelCancel(datum: Datum) {
    this.cardEditForm(datum)
  }

  private getFormContDefault() {
    let form_cont = d3.select(this.cont).select('div.f3-form-cont').node() as HTMLElement
    if (!form_cont) form_cont = d3.select(this.cont).append('div').classed('f3-form-cont', true).node()!

    return {
      el: form_cont,
      populate(form_element: HTMLElement) {
        form_cont.innerHTML = ''
        form_cont.appendChild(form_element)
      },
      open() {
        d3.select(form_cont).classed('opened', true)
      },
      close() {
        d3.select(form_cont).classed('opened', false).html('')
      },
    }
  }

  setFormCont(formCont: EditTree['formCont']) {
    this.formCont = formCont
    return this
  }

  private getFormContModal() {
    const modal = this.modal
    return {
      populate(form_element: HTMLElement) {
        modal.activate(form_element)
      },
      open() {
        // no-op: modal.activate() (called from populate()) already opens the modal
      },
      close() {
        modal.close()
      },
    }
  }

  /**
   * Choose how the edit form is displayed: the default fixed side panel, or a modal dialog
   * (built on the same reusable Modal used for remove-relative confirmation and the
   * add-relative wizard).
   * @param mode - 'panel' (default) or 'modal'
   */
  setEditFormDisplay(mode: 'panel' | 'modal') {
    this.formCont = mode === 'modal' ? this.getFormContModal() : this.getFormContDefault()
    return this
  }

  cardEditForm(datum: Datum, opts?: {suppressLinkExisting?: boolean}) {
    const props: {
      onCancel?: () => void,
      addRelative?: AddRelative,
      removeRelative?: any,  // todo: RemoveRelative
      deletePerson?: () => void,
    } = {}
    const is_new_rel = datum?._new_rel_data
    if (is_new_rel) {
      props.onCancel = () => this.addRelativeInstance.onCancel!()
    } else {
      props.addRelative = this.addRelativeInstance
      props.removeRelative = this.removeRelativeInstance
      props.deletePerson = () => {
        deletePerson(datum, this.store.getData())
        this.openFormWithId(this.store.getLastAvailableMainDatum().id)
  
        this.store.updateTree({})
      }
    }
  
    const form_creator = formCreatorSetup({
      store: this.store, 
      datum, 
      postSubmitHandler: (props: any) => postSubmitHandler(this, props),
      fields: this.fields, 
      onCancel: () => {},
      editFirst: this.editFirst,
      no_edit: this.no_edit,
      link_existing_rel_config: this.link_existing_rel_config,
      suppressLinkExisting: opts?.suppressLinkExisting,
      onFormCreation: this.onFormCreation,
      onSubmit: this.onSubmit,
      onDelete: this.onDelete,
      canEdit: this.canEdit,
      canDelete: this.canDelete,
      uploadFile: this.upload_handler || undefined,
      ...props
    })
  
    const form_cont = is_new_rel
      ? (this.createFormNew || createFormNew)(form_creator as NewRelFormCreator, this.closeForm.bind(this))
      : (this.createFormEdit || createFormEdit)(form_creator as EditDatumFormCreator, this.closeForm.bind(this))
  
    this.formCont.populate(form_cont)
  
    this.openForm()
  
    function postSubmitHandler(self: EditTree, props: any) {
      if (self.addRelativeInstance.is_active) {
        self.finishAddRelative(datum, props)
        if (!self.is_fixed) self.closeForm()
        return
      }

      if ((datum.to_add || datum.unknown) && props?.link_rel_id) {
        handleLinkRel(datum, props.link_rel_id, self.store.getData())
        self.store.updateMainId(props.link_rel_id)
        self.openFormWithId(props.link_rel_id)
      } else if (!props?.delete) {
        if (self.postSubmit) self.postSubmit(datum, self.store.getData())
        self.openFormWithId(datum.id)
      }

      if (!self.is_fixed) self.closeForm()

      self.store.updateTree({})

      self.updateHistory()
    }
  }

  /**
   * Completes an in-progress add-relative action for `placeholder`: either it was filled in
   * as a new person (normal form submit, no `link_rel_id`) or linked to an existing person
   * (`props.link_rel_id` set - via the placeholder's own form dropdown, or directly from the
   * add-relative wizard's "link an existing person" step). Navigates back to the person the
   * relative was added to, matching the existing add-relative UX either way.
   */
  private finishAddRelative(placeholder: Datum, props: any) {
    this.addRelativeInstance.onChange!(placeholder, props)
    if (this.postSubmit) this.postSubmit(placeholder, this.store.getData())
    const active_datum = this.addRelativeInstance.datum
    if (!active_datum) throw new Error('Active datum not found')
    this.store.updateMainId(active_datum.id)
    this.openWithoutRelCancel(active_datum)
    this.store.updateTree({})
    this.updateHistory()
  }

  openForm() {
    this.formCont.open()
  }
  
  closeForm() {
    this.formCont.close()
    this.store.updateTree({})
  }
  
  fixed() {
    this.is_fixed = true
    if (this.formCont.el) d3.select(this.formCont.el).style('position', 'relative')
  
    return this
  }
  
  absolute() {
    this.is_fixed = false
    if (this.formCont.el) d3.select(this.formCont.el).style('position', 'absolute')
  
    return this
  }
  
  setCardClickOpen(card: Card) {
    card.setOnCardClick((e: MouseEvent, d: TreeDatum) => {
      if (this.isAddingRelative()) {
        this.open(d.data)
      } else if (this.isRemovingRelative()) {
        this.open(d.data)
      } else {
        this.open(d.data)
        card.onCardClickDefault(e, d)
      }
    })
  
    return this
  }
  
  openFormWithId(d_id: Datum['id']) {
    if (d_id) {
      const d = this.store.getDatum(d_id)
      if (!d) throw new Error('Datum not found')
      this.openWithoutRelCancel(d)
    } else {
      const d = this.store.getMainDatum()!
      if (!d) throw new Error('Main datum not found')
      this.openWithoutRelCancel(d)
    }
  }
  
  setNoEdit() {
    this.no_edit = true
  
    return this
  }
  
  setEdit() {
    this.no_edit = false
  
    return this
  }
  
  setFields(fields: any[]) {  // todo: Field[]
    const new_fields = []
    if (!Array.isArray(fields)) {
      console.error('fields must be an array')
      return this
    }
    for (const field of fields) {
      if (typeof field === 'string') {
        new_fields.push({type: 'text', label: field, id: field})
      } else if (typeof field === 'object') {
        if (!field.id) {
          console.error('fields must be an array of objects with id property')
        } else {
          new_fields.push(field)
        }
      } else {
        console.error('fields must be an array of strings or objects')
      }
    }
    this.fields = new_fields

    return this
  }

  /**
   * Set the upload handler used by `file` and `file-list` fields. The library has no
   * knowledge of any particular upload endpoint - the app supplies a function that takes the
   * selected File and the id of the person being edited, does the actual upload (however it
   * likes: fetch, base64-encoding, multipart, a third-party host), and resolves to the URL
   * the uploaded file is now reachable at.
   * @param fn - (file, personId) => Promise<url>
   */
  setUploadHandler(fn: EditTree['upload_handler']) {
    this.upload_handler = fn

    return this
  }

  /**
   * Set the onChange function to be called when the data changes via editing, adding, or removing a relative
   * @param fn - The onChange function
   */
  setOnChange(fn: EditTree['onChange']) {
    this.onChange = fn
  
    return this
  }

  setCanEdit(canEdit: EditTree['canEdit']) {
    this.canEdit = canEdit
    return this
  }

  setCanDelete(canDelete: EditTree['canDelete']) {
    this.canDelete = canDelete
    return this
  }

  setCanAdd(canAdd: AddRelative['canAdd']) {
    this.addRelativeInstance.setCanAdd(canAdd)
    return this
  }
  
  addRelative(datum: Datum | undefined) {
    if (!datum) datum = this.store.getMainDatum()!
    this.addRelativeInstance.activate(datum)
  
    return this
  
  }
  
  setupModal() {
    return modal(this.cont)
  }
  
  setEditFirst(editFirst: EditTree['editFirst']) {
    this.editFirst = editFirst
  
    return this
  }
  
  isAddingRelative() {
    return this.addRelativeInstance.is_active
  }
  
  isRemovingRelative() {
    return this.removeRelativeInstance.is_active
  }
  
  setAddRelLabels(add_rel_labels: AddRelative['addRelLabels']) {
    this.addRelativeInstance.setAddRelLabels(add_rel_labels)
    return this
  }
  
  setLinkExistingRelConfig(link_existing_rel_config: EditTree['link_existing_rel_config']) {
    this.link_existing_rel_config = link_existing_rel_config
    return this
  }
  
  setOnFormCreation(onFormCreation: EditTree['onFormCreation']) {
    this.onFormCreation = onFormCreation
  
    return this
  }
  
  setCreateFormEdit(createFormEdit: EditTree['createFormEdit']) {
    this.createFormEdit = createFormEdit
    return this
  }
  
  setCreateFormNew(createFormNew: EditTree['createFormNew']) {
    this.createFormNew = createFormNew
    return this
  }
  
  private _getStoreDataCopy() {
    let data = JSON.parse(JSON.stringify(this.store.getData()))  // important to make a deep copy of the data
    if (this.addRelativeInstance.is_active) data = this.addRelativeInstance.cleanUp(data)    
    data = cleanupDataJson(data)
    return data
  }

  /**
   * deprecated: use exportData instead. This function will be removed in a future version.
   * Export the data
   * @returns family chart data
   */
  getStoreDataCopy() {
    return this.exportData()
  }


  /**
   * @returns family chart data
   */
  exportData() {
    let data = this._getStoreDataCopy()
    data = formatDataForExport(data, this.store.state.legacy_format)
    return data as Data | LegacyDatum[]
  }
  
  getDataJson() {
    return JSON.stringify(this.exportData(), null, 2)
  }
  
  updateHistory() {
    if (this.history) {
      this.history.changed()
      this.history.controls.updateButtons()
    }
  
    if (this.onChange) this.onChange()
  }
  
  setPostSubmit(postSubmit: EditTree['postSubmit']) {
    this.postSubmit = postSubmit
  
    return this
  }
  
  setOnSubmit(onSubmit: EditTree['onSubmit']) {
    this.onSubmit = onSubmit
    return this
  }
  
  setOnDelete(onDelete: EditTree['onDelete']) {
    this.onDelete = onDelete
    return this
  }
  
  destroy() {
    this.history.controls.destroy()
    this.history = null as any
    if (this.formCont.el) d3.select(this.formCont.el).remove()
    if (this.addRelativeInstance.onCancel) this.addRelativeInstance.onCancel()
    this.store.updateTree({})
  
    return this
  }
}