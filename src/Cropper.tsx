import normalizeWheel from 'normalize-wheel'
import { Area, MediaSize, Point, Size, VideoSrc } from './types'
import {
  getCropSize,
  restrictPosition,
  getDistanceBetweenPoints,
  getRotationBetweenPoints,
  computeCroppedArea,
  getCenter,
  getInitialCropFromCroppedAreaPixels,
  getInitialCropFromCroppedAreaPercentages,
  classNames,
  clamp,
} from './helpers'
import cssStyles from './styles.css'
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  Match,
  mergeProps,
  onCleanup,
  onMount,
  Show,
  splitProps,
  Switch,
} from 'solid-js'

export type CropperProps = {
  image?: string
  video?: string | VideoSrc[]
  transform?: string
  crop: Point
  zoom?: number
  rotation?: number
  aspect: number
  minZoom?: number
  maxZoom?: number
  cropShape?: 'rect' | 'round'
  cropSize?: Size
  objectFit?: 'contain' | 'horizontal-cover' | 'vertical-cover' | 'auto-cover'
  showGrid?: boolean
  zoomSpeed?: number
  zoomWithScroll?: boolean
  onCropChange: (location: Point) => void
  onZoomChange?: (zoom: number) => void
  onRotationChange?: (rotation: number) => void
  onCropComplete?: (croppedArea: Area, croppedAreaPixels: Area) => void
  onCropAreaChange?: (croppedArea: Area, croppedAreaPixels: Area) => void
  onCropSizeChange?: (cropSize: Size) => void
  onInteractionStart?: () => void
  onInteractionEnd?: () => void
  onMediaLoaded?: (mediaSize: MediaSize) => void
  style?: {
    containerStyle?: JSX.CSSProperties
    mediaStyle?: JSX.CSSProperties
    cropAreaStyle?: JSX.CSSProperties
  }
  classes?: {
    containerClassName?: string
    mediaClassName?: string
    cropAreaClassName?: string
  }
  restrictPosition?: boolean
  mediaProps?: JSX.ImgHTMLAttributes<HTMLElement> | JSX.VideoHTMLAttributes<HTMLElement>
  disableAutomaticStylesInjection?: boolean
  initialCroppedAreaPixels?: Area
  initialCroppedAreaPercentages?: Area
  onTouchRequest?: (e: TouchEvent) => boolean
  onWheelRequest?: (e: WheelEvent) => boolean
  setImageRef?: (ref: HTMLImageElement) => void
  setVideoRef?: (ref: HTMLVideoElement) => void
  setMediaSize?: (size: MediaSize) => void
  setCropSize?: (size: Size) => void
  nonce?: string
}

type State = {
  cropSize: Size | null
  hasWheelJustStarted: boolean
}

const MIN_ZOOM = 1
const MAX_ZOOM = 3

type GestureEvent = UIEvent & {
  rotation: number
  scale: number
  clientX: number
  clientY: number
}
const Cropper: Component<CropperProps> = paramProps => {
  const props: CropperProps = mergeProps(
    {
      zoom: 1,
      rotation: 0,
      aspect: 4 / 3,
      maxZoom: MAX_ZOOM,
      minZoom: MIN_ZOOM,
      cropShape: 'rect',
      objectFit: 'contain',
      showGrid: true,
      style: {},
      classes: {},
      mediaProps: {},
      zoomSpeed: 1,
      restrictPosition: true,
      zoomWithScroll: true,
    },
    paramProps,
  ) as CropperProps
  let imageRef: HTMLImageElement
  let videoRef: HTMLVideoElement
  let containerRef: HTMLDivElement
  let styleRef: HTMLStyleElement
  let containerRect: DOMRect
  const [mediaSize, setMediaSize] = createSignal({
    width: 0,
    height: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  } as MediaSize)
  let dragStartPosition: Point = { x: 0, y: 0 }
  let dragStartCrop: Point = { x: 0, y: 0 }
  let gestureZoomStart = 0
  let gestureRotationStart = 0
  let isTouching = false
  let lastPinchDistance = 0
  let lastPinchRotation = 0
  let rafDragTimeout: number | null = null
  let rafPinchTimeout: number | null = null
  let wheelTimer: number | null = null
  let currentDoc: Document | null = typeof document !== 'undefined' ? document : null
  let currentWindow: Window | null = typeof window !== 'undefined' ? window : null
  let resizeObserver: ResizeObserver | null = null
  const [state, setState] = createSignal({
    cropSize: null,
    hasWheelJustStarted: false,
  } as State)
  onMount(() => {
    if (!currentDoc || !currentWindow) return
    if (containerRef) {
      console.log(containerRef, containerRef.ownerDocument)
      if (containerRef.ownerDocument) {
        currentDoc = containerRef.ownerDocument
      }
      if (currentDoc.defaultView) {
        currentWindow = currentDoc.defaultView
      }

      initResizeObserver()
      // only add window resize listener if ResizeObserver is not supported. Otherwise, it would be redundant
      if (typeof window.ResizeObserver === 'undefined') {
        currentWindow.addEventListener('resize', computeSizes)
      }
      props.zoomWithScroll && containerRef.addEventListener('wheel', onWheel, { passive: false })
      containerRef.addEventListener('gesturestart', onGestureStart as EventListener)
    }

    if (!props.disableAutomaticStylesInjection) {
      styleRef = currentDoc.createElement('style')
      styleRef.setAttribute('type', 'text/css')
      if (props.nonce) {
        styleRef.setAttribute('nonce', props.nonce)
      }
      styleRef.innerHTML = cssStyles
      currentDoc.head.appendChild(styleRef)
    }

    // when rendered via SSR, the image can already be loaded and its onLoad callback will never be called
    if (imageRef && imageRef.complete) {
      onMediaLoad()
    }

    // set image and video refs in the parent if the callbacks exist
    if (props.setImageRef) {
      props.setImageRef(imageRef)
    }

    if (props.setVideoRef) {
      props.setVideoRef(videoRef)
    }
    onCleanup(() => {
      if (!currentDoc || !currentWindow) return
      if (typeof window.ResizeObserver === 'undefined') {
        currentWindow.removeEventListener('resize', computeSizes)
      }
      resizeObserver?.disconnect()
      if (containerRef) {
        containerRef.removeEventListener('gesturestart', preventZoomSafari)
      }

      if (styleRef) {
        styleRef.parentNode?.removeChild(styleRef)
      }

      cleanEvents()
      props.zoomWithScroll && clearScrollEvent()
    })
  })
  createEffect((prevProps: CropperProps): CropperProps => {
    if (prevProps.rotation !== props.rotation) {
      computeSizes()
      recomputeCropPosition()
    } else if (prevProps.aspect !== props.aspect) {
      computeSizes()
    } else if (prevProps.zoom !== props.zoom) {
      recomputeCropPosition()
    } else if (
      prevProps.cropSize?.height !== props.cropSize?.height ||
      prevProps.cropSize?.width !== props.cropSize?.width
    ) {
      computeSizes()
    } else if (prevProps.crop?.x !== props.crop?.x || prevProps.crop?.y !== props.crop?.y) {
      emitCropAreaChange()
    }
    if (prevProps.zoomWithScroll !== props.zoomWithScroll && containerRef) {
      props.zoomWithScroll
        ? containerRef.addEventListener('wheel', onWheel, { passive: false })
        : clearScrollEvent()
    }
    if (prevProps.video !== props.video) {
      videoRef?.load()
    }
    return props
  }, props)
  const initResizeObserver = () => {
    if (typeof window.ResizeObserver === 'undefined' || !containerRef) {
      return
    }
    let isFirstResize = true
    resizeObserver = new window.ResizeObserver(entries => {
      if (isFirstResize) {
        isFirstResize = false // observe() is called on mount, we don't want to trigger a recompute on mount
        return
      }
      computeSizes()
    })
    resizeObserver.observe(containerRef)
  }

  // this is to prevent Safari on iOS >= 10 to zoom the page
  const preventZoomSafari = (e: Event) => e.preventDefault()
  const cleanEvents = () => {
    if (!currentDoc) return
    currentDoc.removeEventListener('mousemove', onMouseMove)
    currentDoc.removeEventListener('mouseup', onDragStopped)
    currentDoc.removeEventListener('touchmove', onTouchMove)
    currentDoc.removeEventListener('touchend', onDragStopped)
    currentDoc.removeEventListener('gesturemove', onGestureMove as EventListener)
    currentDoc.removeEventListener('gestureend', onGestureEnd as EventListener)
  }
  const clearScrollEvent = () => {
    if (containerRef) containerRef.removeEventListener('wheel', onWheel)
    if (wheelTimer) {
      clearTimeout(wheelTimer)
    }
  }
  const onMediaLoad = () => {
    const cropSize = computeSizes()

    if (cropSize) {
      emitCropData()
      setInitialCrop(cropSize)
    }

    if (props.onMediaLoaded) {
      props.onMediaLoaded(mediaSize())
    }
  }

  const setInitialCrop = (cropSize: Size) => {
    if (props.initialCroppedAreaPercentages) {
      const { crop, zoom } = getInitialCropFromCroppedAreaPercentages(
        props.initialCroppedAreaPercentages,
        mediaSize(),
        props.rotation!,
        cropSize,
        props.minZoom!,
        props.maxZoom!,
      )

      props.onCropChange(crop)
      props.onZoomChange && props.onZoomChange(zoom)
    } else if (props.initialCroppedAreaPixels) {
      const { crop, zoom } = getInitialCropFromCroppedAreaPixels(
        props.initialCroppedAreaPixels,
        mediaSize(),
        props.rotation,
        cropSize,
        props.minZoom!,
        props.maxZoom!,
      )

      props.onCropChange(crop)
      props.onZoomChange && props.onZoomChange(zoom)
    }
  }
  const getAspect = () => {
    const { cropSize, aspect } = props
    if (cropSize) {
      return cropSize.width / cropSize.height
    }
    return aspect
  }
  const computeSizes = () => {
    const mediaRef = imageRef || videoRef

    if (mediaRef && containerRef) {
      containerRect = containerRef.getBoundingClientRect()
      const containerAspect = containerRect.width / containerRect.height
      const naturalWidth = imageRef?.naturalWidth || videoRef?.videoWidth || 0
      const naturalHeight = imageRef?.naturalHeight || videoRef?.videoHeight || 0
      const isMediaScaledDown =
        mediaRef.offsetWidth < naturalWidth || mediaRef.offsetHeight < naturalHeight
      const mediaAspect = naturalWidth / naturalHeight

      // We do not rely on the offsetWidth/offsetHeight if the media is scaled down
      // as the values they report are rounded. That will result in precision losses
      // when calculating zoom. We use the fact that the media is positionned relative
      // to the container. That allows us to use the container's dimensions
      // and natural aspect ratio of the media to calculate accurate media size.
      // However, for this to work, the container should not be rotated
      let renderedMediaSize

      if (isMediaScaledDown) {
        switch (props.objectFit) {
          default:
          case 'contain':
            renderedMediaSize =
              containerAspect > mediaAspect
                ? {
                    width: containerRect.height * mediaAspect,
                    height: containerRect.height,
                  }
                : {
                    width: containerRect.width,
                    height: containerRect.width / mediaAspect,
                  }
            break
          case 'horizontal-cover':
            renderedMediaSize = {
              width: containerRect.width,
              height: containerRect.width / mediaAspect,
            }
            break
          case 'vertical-cover':
            renderedMediaSize = {
              width: containerRect.height * mediaAspect,
              height: containerRect.height,
            }
            break
          case 'auto-cover':
            renderedMediaSize =
              naturalWidth > naturalHeight
                ? {
                    width: containerRect.width,
                    height: containerRect.width / mediaAspect,
                  }
                : {
                    width: containerRect.height * mediaAspect,
                    height: containerRect.height,
                  }
            break
        }
      } else {
        renderedMediaSize = {
          width: mediaRef.offsetWidth,
          height: mediaRef.offsetHeight,
        }
      }
      setMediaSize({
        ...renderedMediaSize,
        naturalWidth,
        naturalHeight,
      })

      // set media size in the parent
      if (props.setMediaSize) {
        props.setMediaSize(mediaSize())
      }

      const cropSize =
        props.cropSize ||
        getCropSize(
          mediaSize().width,
          mediaSize().height,
          containerRect.width,
          containerRect.height,
          props.aspect,
          props.rotation,
        )

      if (
        state().cropSize?.height !== cropSize.height ||
        state().cropSize?.width !== cropSize.width
      ) {
        props.onCropSizeChange && props.onCropSizeChange(cropSize)
      }
      console.log('check size', state().cropSize?.height, state().cropSize?.width)
      setState(prev => ({ ...prev, cropSize }))
      recomputeCropPosition()
      // pass crop size to parent
      if (props.setCropSize) {
        props.setCropSize(cropSize)
      }

      return cropSize
    }
  }
  const getMousePoint = (e: MouseEvent | GestureEvent) => ({
    x: Number(e.clientX),
    y: Number(e.clientY),
  })
  const getTouchPoint = (touch: Touch) => ({
    x: Number(touch.clientX),
    y: Number(touch.clientY),
  })
  const onMouseDown = (e: MouseEvent) => {
    if (!currentDoc) return
    e.preventDefault()
    currentDoc.addEventListener('mousemove', onMouseMove)
    currentDoc.addEventListener('mouseup', onDragStopped)
    onDragStart(getMousePoint(e))
  }
  const onMouseMove = (e: MouseEvent) => onDrag(getMousePoint(e))

  const onTouchStart = (e: TouchEvent) => {
    if (!currentDoc) return
    isTouching = true
    if (props.onTouchRequest && !props.onTouchRequest(e)) {
      return
    }

    currentDoc.addEventListener('touchmove', onTouchMove, { passive: false }) // iOS 11 now defaults to passive: true
    currentDoc.addEventListener('touchend', onDragStopped)

    if (e.touches.length === 2) {
      onPinchStart(e)
    } else if (e.touches.length === 1) {
      onDragStart(getTouchPoint(e.touches[0]!))
    }
  }
  const onTouchMove = (e: TouchEvent) => {
    // Prevent whole page from scrolling on iOS.
    e.preventDefault()
    if (e.touches.length === 2) {
      onPinchMove(e)
    } else if (e.touches.length === 1) {
      onDrag(getTouchPoint(e.touches[0]!))
    }
  }
  const onGestureStart = (e: GestureEvent) => {
    if (!currentDoc) return
    e.preventDefault()
    currentDoc.addEventListener('gesturechange', onGestureMove as EventListener)
    currentDoc.addEventListener('gestureend', onGestureEnd as EventListener)
    gestureZoomStart = props.zoom!
    gestureRotationStart = props.rotation!
  }

  const onGestureMove = (e: GestureEvent) => {
    e.preventDefault()
    if (isTouching) {
      // this is to avoid conflict between gesture and touch events
      return
    }

    const point = getMousePoint(e)
    const newZoom = gestureZoomStart - 1 + e.scale
    setNewZoom(newZoom, point, { shouldUpdatePosition: true })
    if (props.onRotationChange) {
      const newRotation = gestureRotationStart + e.rotation
      props.onRotationChange(newRotation)
    }
  }

  const onGestureEnd = (e: GestureEvent) => {
    cleanEvents()
  }

  const onDragStart = ({ x, y }: Point) => {
    dragStartPosition = { x, y }
    dragStartCrop = { ...props.crop }
    props.onInteractionStart?.()
  }

  const onDrag = ({ x, y }: Point) => {
    if (!currentWindow) return
    if (rafDragTimeout) currentWindow.cancelAnimationFrame(rafDragTimeout)

    rafDragTimeout = currentWindow.requestAnimationFrame(() => {
      if (!state().cropSize) return
      if (x === undefined || y === undefined) return
      const offsetX = x - dragStartPosition.x
      const offsetY = y - dragStartPosition.y
      const requestedPosition = {
        x: dragStartCrop.x + offsetX,
        y: dragStartCrop.y + offsetY,
      }

      const newPosition = props.restrictPosition
        ? restrictPosition(
            requestedPosition,
            mediaSize(),
            state().cropSize as Size,
            props.zoom!,
            props.rotation,
          )
        : requestedPosition
      props.onCropChange(newPosition)
    })
  }

  const onDragStopped = () => {
    isTouching = false
    cleanEvents()
    emitCropData()
    props.onInteractionEnd?.()
  }

  const onPinchStart = (e: TouchEvent) => {
    const pointA = getTouchPoint(e.touches[0]!)
    const pointB = getTouchPoint(e.touches[1]!)
    lastPinchDistance = getDistanceBetweenPoints(pointA, pointB)
    lastPinchRotation = getRotationBetweenPoints(pointA, pointB)
    onDragStart(getCenter(pointA, pointB))
  }

  const onPinchMove = (e: TouchEvent) => {
    if (!currentDoc || !currentWindow) return
    const pointA = getTouchPoint(e.touches[0]!)
    const pointB = getTouchPoint(e.touches[1]!)
    const center = getCenter(pointA, pointB)
    onDrag(center)

    if (rafPinchTimeout) currentWindow.cancelAnimationFrame(rafPinchTimeout)
    rafPinchTimeout = currentWindow.requestAnimationFrame(() => {
      const distance = getDistanceBetweenPoints(pointA, pointB)
      const newZoom = props.zoom! * (distance / lastPinchDistance)
      setNewZoom(newZoom, center, { shouldUpdatePosition: false })
      lastPinchDistance = distance

      const rotation = getRotationBetweenPoints(pointA, pointB)
      const newRotation = props.rotation! + (rotation - lastPinchRotation)
      props.onRotationChange && props.onRotationChange(newRotation)
      lastPinchRotation = rotation
    })
  }

  const onWheel = (e: WheelEvent) => {
    if (!currentWindow) return
    if (props.onWheelRequest && !props.onWheelRequest(e)) {
      return
    }

    e.preventDefault()
    const point = getMousePoint(e)
    const { pixelY } = normalizeWheel(e)
    const newZoom = props.zoom! - (pixelY * props.zoomSpeed!) / 200
    setNewZoom(newZoom, point, { shouldUpdatePosition: true })

    if (!state().hasWheelJustStarted) {
      setState(prev => ({ ...prev, hasWheelJustStarted: true }))
      props.onInteractionStart?.()
    }

    if (wheelTimer) {
      clearTimeout(wheelTimer)
    }
    wheelTimer = currentWindow.setTimeout(() => {
      setState(prev => ({ ...prev, hasWheelJustStarted: false }))
      props.onInteractionEnd?.()
    }, 250)
  }

  const getPointOnContainer = ({ x, y }: Point) => {
    if (!containerRect) {
      throw new Error('The Cropper is not mounted')
    }
    return {
      x: containerRect.width / 2 - (x - containerRect.left),
      y: containerRect.height / 2 - (y - containerRect.top),
    }
  }

  const getPointOnMedia = ({ x, y }: Point) => {
    const { crop, zoom } = props
    return {
      x: (x + crop.x) / zoom!,
      y: (y + crop.y) / zoom!,
    }
  }

  const setNewZoom = (zoom: number, point: Point, { shouldUpdatePosition = true } = {}) => {
    if (!state().cropSize || !props.onZoomChange) return

    const newZoom = clamp(zoom, props.minZoom!, props.maxZoom!)

    if (shouldUpdatePosition) {
      const zoomPoint = getPointOnContainer(point)
      const zoomTarget = getPointOnMedia(zoomPoint)
      const requestedPosition = {
        x: zoomTarget.x * newZoom - zoomPoint.x,
        y: zoomTarget.y * newZoom - zoomPoint.y,
      }

      const newPosition = props.restrictPosition
        ? restrictPosition(
            requestedPosition,
            mediaSize(),
            state().cropSize as Size,
            newZoom,
            props.rotation,
          )
        : requestedPosition

      props.onCropChange(newPosition)
    }
    props.onZoomChange(newZoom)
  }

  const getCropData = () => {
    if (!state().cropSize) {
      return null
    }

    // this is to ensure the crop is correctly restricted after a zoom back (https://github.com/ValentinH/react-easy-crop/issues/6)
    const restrictedPosition = props.restrictPosition
      ? restrictPosition(
          props.crop,
          mediaSize(),
          state().cropSize as Size,
          props.zoom!,
          props.rotation,
        )
      : props.crop
    return computeCroppedArea(
      restrictedPosition,
      mediaSize(),
      state().cropSize as Size,
      getAspect(),
      props.zoom!,
      props.rotation,
      props.restrictPosition,
    )
  }

  const emitCropData = () => {
    const cropData = getCropData()
    if (!cropData) return

    const { croppedAreaPercentages, croppedAreaPixels } = cropData
    if (props.onCropComplete) {
      props.onCropComplete(croppedAreaPercentages, croppedAreaPixels)
    }

    if (props.onCropAreaChange) {
      props.onCropAreaChange(croppedAreaPercentages, croppedAreaPixels)
    }
  }

  const emitCropAreaChange = () => {
    const cropData = getCropData()
    if (!cropData) return

    const { croppedAreaPercentages, croppedAreaPixels } = cropData
    if (props.onCropAreaChange) {
      props.onCropAreaChange(croppedAreaPercentages, croppedAreaPixels)
    }
  }

  const recomputeCropPosition = () => {
    if (!state().cropSize) return

    const newPosition = props.restrictPosition
      ? restrictPosition(
          props.crop,
          mediaSize(),
          state().cropSize as Size,
          props.zoom!,
          props.rotation!,
        )
      : props.crop

    props.onCropChange(newPosition)
    emitCropData()
  }
  const [local, _] = splitProps(props, [
    'image',
    'video',
    'mediaProps',
    'transform',
    'crop',
    'rotation',
    'zoom',
    'cropShape',
    'showGrid',
    'style',
    'classes',
    'objectFit',
  ])
  const x = createMemo(() => local.crop.x)
  const y = createMemo(() => local.crop.y)
  const containerStyle = createMemo(() => local.style!.containerStyle)
  const cropAreaStyle = createMemo(() => local.style!.cropAreaStyle)
  const mediaStyle = createMemo(() => local.style!.mediaStyle)
  const containerClassName = createMemo(() => local.classes!.containerClassName)
  const cropAreaClassName = createMemo(() => local.classes!.cropAreaClassName)
  const mediaClassName = createMemo(() => local.classes!.mediaClassName)
  const width = createMemo(() => state().cropSize?.width)
  const height = createMemo(() => state().cropSize?.height)
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      ref={containerRef!}
      data-testid="container"
      style={containerStyle()}
      class={classNames('reactEasyCrop_Container', containerClassName())}
    >
      <Switch>
        <Match when={local.image} keyed>
          <img
            alt=""
            class={classNames(
              'reactEasyCrop_Image',
              local.objectFit === 'contain' && 'reactEasyCrop_Contain',
              local.objectFit === 'horizontal-cover' && 'reactEasyCrop_Cover_Horizontal',
              local.objectFit === 'vertical-cover' && 'reactEasyCrop_Cover_Vertical',
              local.objectFit === 'auto-cover' &&
                (mediaSize().naturalWidth > mediaSize().naturalHeight
                  ? 'reactEasyCrop_Cover_Horizontal'
                  : 'reactEasyCrop_Cover_Vertical'),
              mediaClassName(),
            )}
            {...local.mediaProps}
            src={local.image}
            ref={imageRef!}
            style={{
              ...mediaStyle(),
              transform:
                local.transform ||
                `translate(${x()}px, ${y()}px) rotate(${local.rotation}deg) scale(${local.zoom})`,
            }}
            onLoad={onMediaLoad}
          />
        </Match>
        <Match when={local.video} keyed>
          <video
            autoplay
            loop
            muted={true}
            class={classNames(
              'reactEasyCrop_Video',
              local.objectFit === 'contain' && 'reactEasyCrop_Contain',
              local.objectFit === 'horizontal-cover' && 'reactEasyCrop_Cover_Horizontal',
              local.objectFit === 'vertical-cover' && 'reactEasyCrop_Cover_Vertical',
              local.objectFit === 'auto-cover' &&
                (mediaSize().naturalWidth > mediaSize().naturalHeight
                  ? 'reactEasyCrop_Cover_Horizontal'
                  : 'reactEasyCrop_Cover_Vertical'),
              mediaClassName(),
            )}
            {...local.mediaProps}
            ref={videoRef!}
            onLoadedMetadata={onMediaLoad}
            style={{
              ...mediaStyle(),
              transform:
                local.transform ||
                `translate(${x}px, ${y}px) rotate(${local.rotation}deg) scale(${local.zoom})`,
            }}
            controls={false}
          >
            <For each={Array.isArray(local.video) ? local.video : [{ src: local.video }]}>
              {item => <source {...item} />}
            </For>
          </video>
        </Match>
      </Switch>
      <Show when={state().cropSize} keyed>
        <div
          style={{
            ...cropAreaStyle(),
            width: width() + 'px',
            height: height() + 'px',
          }}
          data-testid="cropper"
          class={classNames(
            'reactEasyCrop_CropArea',
            local.cropShape === 'round' && 'reactEasyCrop_CropAreaRound',
            local.showGrid && 'reactEasyCrop_CropAreaGrid',
            cropAreaClassName(),
          )}
        />
      </Show>
    </div>
  )
}

export default Cropper
