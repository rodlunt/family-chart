import * as d3 from "d3"

export default function(cont: HTMLElement) { return new Modal(cont) }

export class Modal {

  cont: HTMLElement
  modal_cont: HTMLElement
  active: boolean
  onClose: (() => void) | null
  previouslyFocused: HTMLElement | null
  private keydownHandler: ((event: KeyboardEvent) => void) | null

  constructor(cont: HTMLElement) {
    this.cont = cont
    this.active = false
    this.onClose = null
    this.previouslyFocused = null
    this.keydownHandler = null

    this.modal_cont = d3.select(this.cont).append('div').attr('class', 'f3-modal').node()!
    d3.select(this.modal_cont).style('display', 'none')
    this.create()
  }

  create() {
    const modal = d3.select(this.modal_cont)
    modal.html(`
      <div class="f3-modal-content" role="dialog" aria-modal="true">
        <span class="f3-modal-close" role="button" tabindex="0" aria-label="Close">&times;</span>
        <div class="f3-modal-content-inner"></div>
        <div class="f3-modal-content-bottom"></div>
      </div>
    `)


    modal.select('.f3-modal-close').on('click', () => {
      this.close()
    })

    modal.select('.f3-modal-close').on('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        this.close()
      }
    })

    modal.on('click', (event) => {
      if (event.target == modal.node()) {
        this.close()
      }
    })
  }
  
  activate(content: string | HTMLElement, {boolean, onAccept, onCancel}: {boolean?: boolean, onAccept?: () => void, onCancel?: () => void}={}) {
    this.reset()
  
    const modal_content_inner = d3.select(this.modal_cont).select('.f3-modal-content-inner').node()! as HTMLElement
    if (typeof content === 'string') {
      modal_content_inner.innerHTML = content
    }
    else {
      modal_content_inner.appendChild(content)
    }
  
    if (boolean) {
      if (!onAccept) throw new Error('onAccept is required')
      if (!onCancel) throw new Error('onCancel is required')
      d3.select(this.modal_cont).select('.f3-modal-content-bottom').html(`
        <button class="f3-modal-accept f3-btn">Accept</button>
        <button class="f3-modal-cancel f3-btn">Cancel</button>
      `)
      d3.select(this.modal_cont).select('.f3-modal-accept').on('click', () => {onAccept(); this.reset(); this.close()})
      d3.select(this.modal_cont).select('.f3-modal-cancel').on('click', () => {this.close()})
      this.onClose = onCancel
    }
  
    this.open()
  }
  
  reset() {
    this.onClose = null
    d3.select(this.modal_cont).select('.f3-modal-content-inner').html('')
    d3.select(this.modal_cont).select('.f3-modal-content-bottom').html('')
  }

  open() {
    if (!this.active) {
      this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      this.keydownHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') this.close()
      }
      document.addEventListener('keydown', this.keydownHandler)
    }
    this.modal_cont.style.display = 'block'
    this.active = true
    this.focusContent()
  }

  // First focusable element inside the modal's actual content (never the close button
  // itself, which sits before it in the DOM) - falling back to the close button only when
  // the content has nothing focusable of its own.
  private focusContent() {
    const content = d3.select(this.modal_cont).select('.f3-modal-content').node() as HTMLElement | null
    if (!content) return
    const focusable_selector = 'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])'
    const inner = content.querySelector<HTMLElement>('.f3-modal-content-inner')
    const bottom = content.querySelector<HTMLElement>('.f3-modal-content-bottom')
    const focusable = (inner && inner.querySelector<HTMLElement>(focusable_selector))
      || (bottom && bottom.querySelector<HTMLElement>(focusable_selector))
    const close_btn = content.querySelector<HTMLElement>('.f3-modal-close')
    const target = focusable || close_btn
    if (target) target.focus()
  }

  close() {
    this.modal_cont.style.display = 'none'
    this.active = false
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = null
    }
    if (this.previouslyFocused) {
      this.previouslyFocused.focus()
      this.previouslyFocused = null
    }
    if (this.onClose) this.onClose()
  }
}