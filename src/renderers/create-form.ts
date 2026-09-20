import { EditDatumFormCreator, NewRelFormCreator } from '../types/form'
import { getHtmlEdit, getHtmlNew } from './create-form-html'

// Same guard as create-form-html.ts's isSafeUrl - these two functions write a stored/just-
// uploaded URL directly into an <a href> or <img src> DOM property, which is just as capable of
// running a javascript: URL as the HTML-string sinks in that file.
function isSafeUrl(url: string) {
  if (url.startsWith('/')) return true
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}


export function createFormNew(form_creator: NewRelFormCreator, closeCallback: () => void) {
  return createForm(form_creator, closeCallback)
}

export function createFormEdit(form_creator: EditDatumFormCreator, closeCallback: () => void) {
  return createForm(form_creator, closeCallback)
}

function createForm(form_creator: EditDatumFormCreator | NewRelFormCreator, closeCallback: () => void) {
  const is_new = isNewRelFormCreator(form_creator)
  const formContainer = document.createElement('div')
  reload()
  return formContainer

  function reload() {
    const formHtml = is_new ? getHtmlNew(form_creator) : getHtmlEdit(form_creator)
    formContainer.innerHTML = formHtml;
    setupEventListenersBase(formContainer, form_creator, closeCallback, reload)
    if (is_new) setupEventListenersNew(formContainer, form_creator)
    else setupEventListenersEdit(formContainer, form_creator, reload)
    if (form_creator.onFormCreation) {
      form_creator.onFormCreation({
        cont: formContainer,
        form_creator: form_creator
      })
    }
  }

  function isNewRelFormCreator(form_creator: EditDatumFormCreator | NewRelFormCreator): form_creator is NewRelFormCreator {
    return 'new_rel' in form_creator
  }
}

function setupEventListenersBase(formContainer: HTMLElement, form_creator: EditDatumFormCreator | NewRelFormCreator, closeCallback: () => void, reload: () => void) {
  const form = formContainer.querySelector('form')!;
  form.addEventListener('submit', form_creator.onSubmit);

  const cancel_btn = form.querySelector('.f3-cancel-btn')!;
  cancel_btn.addEventListener('click', onCancel)

  const close_btn = form.querySelector('.f3-close-btn')!;
  close_btn.addEventListener('click', closeCallback)

  setupFileFieldListeners(formContainer, form_creator)

  function onCancel() {
    form_creator.editable = false
    if (form_creator.onCancel) form_creator.onCancel()
    reload()
  }
}

// Wires the `file` and `file-list` field types. The visible <input type="file"> is a
// side-channel with no `name` attribute, so it never ends up in the form's FormData on
// submit; what actually flows into datum.data is the sibling hidden input, which this
// listener updates directly via the DOM once the app's upload handler resolves. A full
// form reload() is deliberately not used here: reload() re-renders from form_creator.fields'
// initial_value, which only reflects what's in datum.data as of when the form was opened -
// it won't see an upload that hasn't been submitted yet, so a mid-upload reload would drop it.
function setupFileFieldListeners(formContainer: HTMLElement, form_creator: EditDatumFormCreator | NewRelFormCreator) {
  const uploadFile = form_creator.uploadFile

  // Populate each file-list field's item rows from its hidden input's current value - the
  // HTML template deliberately renders that container empty and leaves the listing to here,
  // so there's exactly one place that turns the stored JSON into rows (used both for the
  // initial render and every append/remove afterward).
  formContainer.querySelectorAll<HTMLElement>('.f3-filelist-field').forEach((field_cont) => {
    const hidden = field_cont.querySelector<HTMLInputElement>('input[type=hidden]')
    if (!hidden) return
    renderFileListItems(field_cont, hidden, parseFileListValue(hidden.value))
  })

  formContainer.querySelectorAll<HTMLInputElement>('input.f3-file-input').forEach((input) => {
    input.addEventListener('change', () => onFileChange(input))
  })

  function onFileChange(input: HTMLInputElement) {
    const file = input.files && input.files[0]
    if (!file) return
    const field_cont = input.closest<HTMLElement>('.f3-form-field')
    const status_el = field_cont?.querySelector<HTMLElement>('.f3-file-status')
    const hidden = field_cont?.querySelector<HTMLInputElement>('input[type=hidden]')
    if (!field_cont || !hidden) return

    if (!uploadFile) {
      console.error('family-chart: no upload handler set - call EditTree.setUploadHandler() before using a `file` or `file-list` field')
      if (status_el) status_el.textContent = 'Upload is not configured'
      input.value = ''
      return
    }

    input.disabled = true
    field_cont.classList.add('f3-uploading')
    if (status_el) status_el.textContent = 'Uploading…'

    uploadFile(file, form_creator.datum_id)
      .then((url) => {
        if (input.classList.contains('f3-filelist-input')) {
          const items = parseFileListValue(hidden.value)
          items.push({url, name: file.name})
          hidden.value = JSON.stringify(items)
          renderFileListItems(field_cont, hidden, items)
        } else {
          hidden.value = url
          setSingleFilePreview(field_cont, input, url)
        }
        if (status_el) status_el.textContent = ''
        resetInput()
      })
      .catch((err) => {
        console.error(err)
        if (status_el) status_el.textContent = `Upload failed: ${err?.message || err}`
        resetInput()
      })

    function resetInput() {
      input.disabled = false
      input.value = ''
      field_cont!.classList.remove('f3-uploading')
    }
  }

  function setSingleFilePreview(field_cont: HTMLElement, input: HTMLInputElement, url: string) {
    if (!isSafeUrl(url)) return
    field_cont.querySelector('.f3-file-current')?.remove()
    let preview = field_cont.querySelector<HTMLImageElement>('img.f3-file-preview')
    if (!preview) {
      preview = document.createElement('img')
      preview.className = 'f3-file-preview'
      field_cont.insertBefore(preview, input)
    }
    preview.src = url
  }

  function renderFileListItems(field_cont: HTMLElement, hidden: HTMLInputElement, items: {url: string, name: string}[]) {
    const list_el = field_cont.querySelector<HTMLElement>('.f3-filelist-items')
    if (!list_el) return
    list_el.innerHTML = ''
    items.forEach((item, i) => {
      if (!isSafeUrl(item.url)) return
      const row = document.createElement('div')
      row.className = 'f3-filelist-item'
      const link = document.createElement('a')
      link.href = item.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = item.name || item.url
      const remove_btn = document.createElement('button')
      remove_btn.type = 'button'
      remove_btn.className = 'f3-filelist-remove'
      remove_btn.setAttribute('aria-label', `Remove ${item.name || 'file'}`)
      remove_btn.textContent = '×'
      remove_btn.addEventListener('click', () => {
        const next_items = items.filter((_, idx) => idx !== i)
        hidden.value = JSON.stringify(next_items)
        renderFileListItems(field_cont, hidden, next_items)
      })
      row.append(link, remove_btn)
      list_el.appendChild(row)
    })
  }

  function parseFileListValue(value: string): {url: string, name: string}[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
}

function setupEventListenersNew(formContainer: HTMLElement, form_creator: NewRelFormCreator) {
  const form = formContainer.querySelector('form')!;
  const link_existing_relative_select = form.querySelector('.f3-link-existing-relative select')!;
  if (link_existing_relative_select) {
    link_existing_relative_select.addEventListener('change', form_creator.linkExistingRelative.onSelect);
  }
}

function setupEventListenersEdit(formContainer: HTMLElement, form_creator: EditDatumFormCreator, reload: () => void) {
  const form = formContainer.querySelector('form')!;

  const edit_btn = form.querySelector('.f3-edit-btn');
  if (edit_btn) edit_btn.addEventListener('click', onEdit)

  const delete_btn = form.querySelector('.f3-delete-btn');
  if (delete_btn && form_creator.onDelete) {
    delete_btn.addEventListener('click', form_creator.onDelete);
  }

  const add_relative_btn = form.querySelector('.f3-add-relative-btn');
  if (add_relative_btn && form_creator.addRelative) {
    add_relative_btn.addEventListener('click', () => {
      if (form_creator.addRelativeActive) form_creator.addRelativeCancel()
      else form_creator.addRelative()
      form_creator.addRelativeActive = !form_creator.addRelativeActive
      reload()
    });
  }

  const remove_relative_btn = form.querySelector('.f3-remove-relative-btn');
  if (remove_relative_btn && form_creator.removeRelative) {
    remove_relative_btn.addEventListener('click', () => {
      if (form_creator.removeRelativeActive) form_creator.removeRelativeCancel()
      else form_creator.removeRelative()
      form_creator.removeRelativeActive = !form_creator.removeRelativeActive
      reload()
    });
  }

  const link_existing_relative_select = form.querySelector('.f3-link-existing-relative select');
  if (link_existing_relative_select) {
    link_existing_relative_select.addEventListener('change', form_creator.linkExistingRelative.onSelect);
  }

  function onEdit() {
    form_creator.editable = !form_creator.editable
    reload()
  }
}