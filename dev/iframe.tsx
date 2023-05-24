import { createEffect, createSignal, JSX, Show } from 'solid-js'
import { Portal } from 'solid-js/web'

interface Props {
  children: JSX.Element
}

export default function Iframe({ children }: Props) {
  const [iframeBody, setIframeBody] = createSignal<Element>()
  let iFrameRef: HTMLIFrameElement
  createEffect(() => {
    function setDocumentIfReady() {
      const { contentDocument } = iFrameRef as HTMLIFrameElement
      const { readyState, documentElement } = contentDocument as Document

      if (readyState !== 'interactive' && readyState !== 'complete') {
        return false
      }
      setIframeBody(documentElement.getElementsByTagName('body')[0])
      return true
    }

    if (iFrameRef) {
      iFrameRef.addEventListener('load', setDocumentIfReady)
    }
  })
  return (
    <>
      <iframe
        style={{ height: '100vh', width: '100vw' }}
        ref={iFrameRef!}
        srcdoc="<!doctype html>"
        title="test iframed"
        data-cy="iframe"
      >
        <Show when={iframeBody()} keyed>
          <Portal mount={iframeBody()}>{children}</Portal>
        </Show>
      </iframe>
    </>
  )
}
