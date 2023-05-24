import './styles.css?inline'
import queryString from 'query-string'
import Iframe from './iframe'
import { debounce } from '@solid-primitives/scheduled'
import { Component, createSignal, For, JSX, Show } from 'solid-js'
import Cropper, { Area, Point } from '../src'

const TEST_IMAGES = {
  './images/dog.jpeg': 'Landscape',
  './images/flower.jpeg': 'Portrait',
  './images/cat.jpeg': 'Small portrait',

  // Photos used in tests, used to verify values:
  './images/2000x1200.jpeg': '2000x1200',
}

const urlArgs = queryString.parse(window.location.search)
const imageSrcFromQuery =
  typeof urlArgs.img === 'string' ? urlArgs.img : Object.keys(TEST_IMAGES)[0] // so we can change the image from our tests

type HashType = 'percent' | 'pixel'

type State = {
  imageSrc: string
  crop: Point
  rotation: number
  flip: { horizontal: boolean; vertical: boolean }
  hashType: HashType
  zoom: number
  aspect: number
  cropShape: 'rect' | 'round'
  showGrid: boolean
  zoomSpeed: number
  restrictPosition: boolean
  croppedArea: Area | null
  croppedAreaPixels: Area | null
  initialCroppedAreaPercentages: Area | undefined
  initialCroppedAreaPixels: Area | undefined
  requireCtrlKey: boolean
  requireMultiTouch: boolean
  iframed: boolean
}

const hashNames = ['imageSrc', 'hashType', 'x', 'y', 'width', 'height', 'rotation'] as const

const debouncedUpdateHash = debounce(
  ({ hashType, croppedArea, croppedAreaPixels, imageSrc, rotation }: State) => {
    if (hashType === 'percent') {
      if (croppedArea) {
        window.location.hash = `${imageSrc},percent,${croppedArea.x},${croppedArea.y},${croppedArea.width},${croppedArea.height},${rotation}`
      }
    } else {
      if (croppedAreaPixels) {
        window.location.hash = `${imageSrc},pixel,${croppedAreaPixels.x},${croppedAreaPixels.y},${croppedAreaPixels.width},${croppedAreaPixels.height},${rotation}`
      }
    }
  },
  150,
)

const App: Component = () => {
  let rotation = 0
  let initialCroppedAreaPercentages: Area | undefined = undefined
  let initialCroppedAreaPixels: Area | undefined = undefined
  let hashType: HashType = 'percent'
  let imageSrc = imageSrcFromQuery
  const query = new URLSearchParams(window.location.search)
  if (window && !urlArgs.setInitialCrop) {
    const hashArray = window.location.hash.slice(1).split(',')

    if (hashArray.length === hashNames.length) {
      const hashInfo = {} as Record<(typeof hashNames)[number], string>
      hashNames.forEach((key, index) => (hashInfo[key] = hashArray[index]!))

      const {
        rotation: rotationFromHash,
        hashType: hashTypeFromHash,
        imageSrc: imageSrcFromHash,
        ...croppedArea
      } = hashInfo

      rotation = parseFloat(rotationFromHash)
      imageSrc = imageSrcFromHash

      // create a new object called parsedCroppedArea with values converted to floats
      const parsedCroppedArea = {
        x: parseFloat(croppedArea.x),
        y: parseFloat(croppedArea.y),
        width: parseFloat(croppedArea.width),
        height: parseFloat(croppedArea.height),
      } as Area

      if (hashTypeFromHash === 'percent') {
        initialCroppedAreaPercentages = parsedCroppedArea
      } else {
        initialCroppedAreaPixels = parsedCroppedArea
        hashType = 'pixel'
      }
    }
  }
  const [state, setState] = createSignal({
    imageSrc,
    crop: { x: 0, y: 0 },
    rotation,
    flip: { horizontal: false, vertical: false },
    hashType,
    zoom: 1,
    aspect: 4 / 3,
    cropShape: 'rect',
    showGrid: true,
    zoomSpeed: 1,
    restrictPosition: true,
    croppedArea: null,
    croppedAreaPixels: null,
    initialCroppedAreaPercentages,
    initialCroppedAreaPixels,
    requireCtrlKey: false,
    requireMultiTouch: false,
    iframed: !!query.get('iframed'),
  } as State)
  const onCropChange = (crop: Point) => {
    setState((prev: State) => ({ ...prev, crop }))
  }
  const onCropComplete = (croppedArea: Area, croppedAreaPixels: Area) => {
    console.log('onCropComplete!', croppedArea, croppedAreaPixels)

    setState(prev => ({ ...prev, croppedArea, croppedAreaPixels }))
    updateHash()
  }
  const onCropAreaChange = (croppedArea: Area, croppedAreaPixels: Area) => {
    console.log('onCropAreaChange!', croppedArea, croppedAreaPixels)

    setState(prev => ({ ...prev, croppedArea, croppedAreaPixels }))
  }
  const updateHash = () => {
    if (urlArgs.setInitialCrop) {
      return
    }

    debouncedUpdateHash(state())
  }
  const onZoomChange = (zoom: number) => {
    setState(prev => ({ ...prev, zoom }))
  }
  const onRotationChange = (rotation: number) => {
    setState(prev => ({ ...prev, rotation }))
  }
  const onInteractionStart = () => {
    console.log('user interaction started')
  }
  const onInteractionEnd = () => {
    console.log('user interaction ended')
  }

  const onHashTypeChange: JSX.EventHandler<HTMLSelectElement, Event> = e => {
    setState(prev => ({ ...prev, hashType: e.currentTarget.value as HashType }))
    updateHash()
  }

  const onImageSrcChange: JSX.EventHandler<HTMLSelectElement, Event> = e => {
    setState(prev => ({
      ...prev,
      imageSrc: e.currentTarget.value,
      initialCroppedAreaPercentages: undefined,
      initialCroppedAreaPixels: undefined,
    }))
  }
  return (
    <Show
      when={!state().iframed}
      fallback={
        <Iframe>
          <div class="crop-container">
            <Cropper
              image={state().imageSrc}
              crop={state().crop}
              rotation={state().rotation}
              zoom={state().zoom}
              aspect={state().aspect}
              cropShape={state().cropShape}
              showGrid={state().showGrid}
              zoomSpeed={state().zoomSpeed}
              restrictPosition={state().restrictPosition}
              onCropChange={onCropChange}
              onRotationChange={onRotationChange}
              onCropComplete={onCropComplete}
              onCropAreaChange={onCropAreaChange}
              onZoomChange={onZoomChange}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
            />
          </div>
        </Iframe>
      }
      keyed
    >
      <div class="App">
        <div class="controls">
          <div>
            <label>
              <input
                type="range"
                min={0}
                max={360}
                list="rotation-detents"
                value={state().rotation}
                onChange={({ currentTarget: { value: rotation } }) =>
                  setState(prev => ({ ...prev, rotation: Number(rotation) }))
                }
              />
              {state().rotation}°
            </label>
            <datalist id="rotation-detents">
              <option value="90" />
              <option value="180" />
              <option value="270" />
            </datalist>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={state().flip.horizontal}
                onChange={() =>
                  setState(prev => ({
                    ...prev,
                    rotation: 360 - prev.rotation,
                    flip: {
                      horizontal: !prev.flip.horizontal,
                      vertical: prev.flip.vertical,
                    },
                  }))
                }
              />
              Flip Horizontal
            </label>
            <label>
              <input
                type="checkbox"
                checked={state().flip.vertical}
                onChange={() =>
                  setState(prev => ({
                    ...prev,
                    rotation: 360 - prev.rotation,
                    flip: {
                      horizontal: prev.flip.horizontal,
                      vertical: !prev.flip.vertical,
                    },
                  }))
                }
              />
              Flip Vertical
            </label>
            <label>
              <input
                type="checkbox"
                checked={state().requireCtrlKey}
                onChange={() =>
                  setState(prev => ({
                    ...prev,
                    requireCtrlKey: !prev.requireCtrlKey,
                  }))
                }
              />
              Require Ctrl Key
            </label>
            <label>
              <input
                type="checkbox"
                checked={state().requireMultiTouch}
                onChange={() =>
                  setState(prev => ({
                    ...prev,
                    requireMultiTouch: !prev.requireMultiTouch,
                  }))
                }
              />
              Require Multi-Touch
            </label>
            <div>
              <label>
                Save to hash:
                <select value={state().hashType} onChange={onHashTypeChange}>
                  <option value="percent">Percent</option>
                  <option value="pixel">Pixel</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                Picture:
                <select value={state().imageSrc} onChange={onImageSrcChange}>
                  {Object.entries(TEST_IMAGES).map(([key, value]) => (
                    <option value={key}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <button
            id="horizontal-center-button"
            onClick={() => {
              setState(prev => ({
                ...prev,
                crop: { ...state().crop, x: 0 },
              }))
            }}
          >
            Center Horizontally
          </button>
          <div>
            crop: {state().crop.x}, {state().crop.y}
            <br />
            zoom: {state().zoom}
          </div>
          <div>
            <p>Crop Area:</p>
            <div>
              <Show when={state().croppedArea} keyed>
                <For each={['x', 'y', 'width', 'height'] as const}>
                  {attribute => (
                    <div>
                      {attribute}:
                      <b id={`crop-area-${attribute}`}>
                        {Math.round(state().croppedArea![attribute])}
                      </b>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
        <div class="crop-container">
          <Cropper
            image={state().imageSrc}
            crop={state().crop}
            rotation={state().rotation}
            zoom={state().zoom}
            aspect={state().aspect}
            cropShape={state().cropShape}
            showGrid={state().showGrid}
            zoomSpeed={state().zoomSpeed}
            restrictPosition={state().restrictPosition}
            onWheelRequest={
              state().requireCtrlKey
                ? e => {
                    return e.ctrlKey
                  }
                : undefined
            }
            onTouchRequest={
              state().requireMultiTouch
                ? e => {
                    return e.touches.length > 1
                  }
                : undefined
            }
            onCropChange={onCropChange}
            onRotationChange={onRotationChange}
            onCropComplete={onCropComplete}
            onCropAreaChange={onCropAreaChange}
            onZoomChange={onZoomChange}
            onInteractionStart={onInteractionStart}
            onInteractionEnd={onInteractionEnd}
            initialCroppedAreaPixels={
              Boolean(urlArgs.setInitialCrop) // used to set the initial crop in e2e test
                ? { width: 699, height: 524, x: 875, y: 157 }
                : state().initialCroppedAreaPixels
            }
            initialCroppedAreaPercentages={state().initialCroppedAreaPercentages}
            transform={[
              `translate(${state().crop.x}px, ${state().crop.y}px)`,
              `rotateZ(${state().rotation}deg)`,
              `rotateY(${state().flip.horizontal ? 180 : 0}deg)`,
              `rotateX(${state().flip.vertical ? 180 : 0}deg)`,
              `scale(${state().zoom})`,
            ].join(' ')}
          />
        </div>
      </div>
    </Show>
  )
}

export default App
