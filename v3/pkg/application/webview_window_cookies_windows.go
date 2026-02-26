//go:build windows

package application

import (
	"math"
	"net/http"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

type cookiesCompletedHandlerVtbl struct {
	QueryInterface edge.ComProc
	AddRef         edge.ComProc
	Release        edge.ComProc
	Invoke         edge.ComProc
}

type cookiesCompletedHandler struct {
	vtbl *cookiesCompletedHandlerVtbl
	ch   chan []*http.Cookie
}

var cookiesHandlerStore sync.Map // Holds handlers until Invoke to prevent GC.

func cookiesHandlerQueryInterface(this *cookiesCompletedHandler, refiid, object uintptr) uintptr {
	// WebView2 requests IUnknown/ICoreWebView2GetCookiesCompletedHandler on this object.
	*(*unsafe.Pointer)(unsafe.Pointer(object)) = unsafe.Pointer(this)
	return 0
}

func cookiesHandlerAddRef(this *cookiesCompletedHandler) uintptr { return 1 }

func cookiesHandlerRelease(this *cookiesCompletedHandler) uintptr { return 1 }

func cookiesHandlerInvoke(this *cookiesCompletedHandler, errorCode uintptr, list *cookieListRaw) uintptr {
	// The cookie list is owned by WebView2 and must not be released here.
	cookiesHandlerStore.Delete(uintptr(unsafe.Pointer(this)))
	if errorCode != 0 || list == nil {
		select {
		case this.ch <- nil:
		default:
		}
		return 0
	}

	cookies := cookieListToCookies(list)
	select {
	case this.ch <- cookies:
	default:
	}
	return 0
}

var cookiesCompletedHandlerVtblInstance = cookiesCompletedHandlerVtbl{
	QueryInterface: edge.NewComProc(cookiesHandlerQueryInterface),
	AddRef:         edge.NewComProc(cookiesHandlerAddRef),
	Release:        edge.NewComProc(cookiesHandlerRelease),
	Invoke:         edge.NewComProc(cookiesHandlerInvoke),
}

func newCookiesCompletedHandler(ch chan []*http.Cookie) *cookiesCompletedHandler {
	h := &cookiesCompletedHandler{
		vtbl: &cookiesCompletedHandlerVtblInstance,
		ch:   ch,
	}
	cookiesHandlerStore.Store(uintptr(unsafe.Pointer(h)), h)
	return h
}

type cookieManagerRaw struct {
	vtbl *[8]uintptr
}

type cookieListRaw struct {
	vtbl *[5]uintptr
}

type cookieRaw struct {
	vtbl *[16]uintptr
}

func cookieManagerGetCookies(manager *edge.ICoreWebView2CookieManager, uri string, handler *cookiesCompletedHandler) error {
	var uriUTF16 *uint16
	var err error

	// WebView2 treats NULL uri as "all cookies".
	if uri != "" {
		uriUTF16, err = windows.UTF16PtrFromString(uri)
		if err != nil {
			return err
		}
	}

	// Use the vtable directly to avoid passing a Go callback through COM.
	raw := (*cookieManagerRaw)(unsafe.Pointer(manager))
	getProc := raw.vtbl[5]

	hr, _, _ := syscall.SyscallN(
		getProc,
		uintptr(unsafe.Pointer(manager)),
		uintptr(unsafe.Pointer(uriUTF16)),
		uintptr(unsafe.Pointer(handler)),
	)
	if hr != 0 {
		cookiesHandlerStore.Delete(uintptr(unsafe.Pointer(handler)))
		return windows.Errno(hr)
	}
	return nil
}

func cookieListGetCount(list *cookieListRaw) (uint32, error) {
	var count uint32
	hr, _, _ := syscall.SyscallN(
		list.vtbl[3],
		uintptr(unsafe.Pointer(list)),
		uintptr(unsafe.Pointer(&count)),
	)
	if hr != 0 {
		return 0, windows.Errno(hr)
	}
	return count, nil
}

func cookieListGetItem(list *cookieListRaw, index uint32) (*cookieRaw, error) {
	var item *cookieRaw
	hr, _, _ := syscall.SyscallN(
		list.vtbl[4],
		uintptr(unsafe.Pointer(list)),
		uintptr(index),
		uintptr(unsafe.Pointer(&item)),
	)
	if hr != 0 {
		return nil, windows.Errno(hr)
	}
	return item, nil
}

func cookieRelease(c *cookieRaw) {
	syscall.SyscallN(c.vtbl[2], uintptr(unsafe.Pointer(c))) //nolint:errcheck
}

func cookieListRelease(list *cookieListRaw) {
	syscall.SyscallN(list.vtbl[2], uintptr(unsafe.Pointer(list))) //nolint:errcheck
}

func cookieGetStringProp(c *cookieRaw, slot int) string {
	var ptr *uint16
	hr, _, _ := syscall.SyscallN(
		c.vtbl[slot],
		uintptr(unsafe.Pointer(c)),
		uintptr(unsafe.Pointer(&ptr)),
	)
	if hr != 0 || ptr == nil {
		return ""
	}
	// The cookie object owns this string; it is released with cookieRelease.
	return windows.UTF16PtrToString(ptr)
}

func cookieGetBoolProp(c *cookieRaw, slot int) bool {
	var val int32
	hr, _, _ := syscall.SyscallN(
		c.vtbl[slot],
		uintptr(unsafe.Pointer(c)),
		uintptr(unsafe.Pointer(&val)),
	)
	if hr != 0 {
		return false
	}
	return val != 0
}

func cookieGetExpires(c *cookieRaw) float64 {
	var bits uint64
	// WebView2 returns the double value via a uint64 out-parameter.
	syscall.SyscallN( //nolint:errcheck
		c.vtbl[8],
		uintptr(unsafe.Pointer(c)),
		uintptr(unsafe.Pointer(&bits)),
	)
	return math.Float64frombits(bits)
}

func cookieListToCookies(list *cookieListRaw) []*http.Cookie {
	count, err := cookieListGetCount(list)
	if err != nil {
		return nil
	}

	cookies := make([]*http.Cookie, 0, count)
	for i := range count {
		item, err := cookieListGetItem(list, i)
		if err != nil {
			continue
		}

		name := cookieGetStringProp(item, 3)
		value := cookieGetStringProp(item, 4)
		domain := cookieGetStringProp(item, 6)
		path := cookieGetStringProp(item, 7)
		expiresF := cookieGetExpires(item)
		httpOnly := cookieGetBoolProp(item, 10)
		secure := cookieGetBoolProp(item, 14)
		cookieRelease(item)

		c := &http.Cookie{
			Name:     name,
			Value:    value,
			Domain:   domain,
			Path:     path,
			HttpOnly: httpOnly,
			Secure:   secure,
		}
		if expiresF >= 0 && !math.IsNaN(expiresF) && !math.IsInf(expiresF, 0) {
			c.Expires = time.Unix(int64(expiresF), 0)
		}
		cookies = append(cookies, c)
	}
	return cookies
}
