const fs = require('fs');

let file = fs.readFileSync('v3/pkg/application/webview_window_windows.go', 'utf8');

file = file.replace(`import (
	"errors"
	"fmt"
	"net/url"`, `import (
	"errors"
	"fmt"
	"net/http"
	"net/url"`);

// Let's modify WndProc to handle our custom message
file = file.replace(`type windowsWebviewWindow struct {`, `
type cookieRequest struct {
	url string
	resultChan chan []*http.Cookie
}

type windowsWebviewWindow struct {`);

file = file.replace(/case w32\.WM_GETMINMAXINFO:/m, `	case w32.WM_APP + 100:
		// Handle custom cookie request
		req := (*cookieRequest)(unsafe.Pointer(wparam))
		
		cm, err := w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager inside WndProc:", err)
			req.resultChan <- nil
			return 0
		}
		defer cm.Release()

		list, err := cm.GetCookies(req.url)
		if err != nil {
			req.resultChan <- nil
			return 0
		}
		defer list.Release()

		count, err := list.GetCount()
		if err != nil {
			req.resultChan <- nil
			return 0
		}

		var found []*http.Cookie
		for i := uint32(0); i < count; i++ {
			cookie, err := list.GetItem(i)
			if err != nil {
				continue
			}

			name, _ := cookie.GetName()
			value, _ := cookie.GetValue()
			domain, _ := cookie.GetDomain()
			path, _ := cookie.GetPath()
			expires, _ := cookie.GetExpires()
			isHttpOnly, _ := cookie.GetIsHttpOnly()
			isSecure, _ := cookie.GetIsSecure()

			found = append(found, &http.Cookie{
				Name:     name,
				Value:    value,
				Domain:   domain,
				Path:     path,
				Expires:  time.Unix(int64(expires), 0),
				HttpOnly: isHttpOnly,
				Secure:   isSecure,
			})
			cookie.Release()
		}
		
		req.resultChan <- found
		return 0

	case w32.WM_GETMINMAXINFO:`);

file = file.replace(/func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	req := &cookieRequest{
		url: url,
		resultChan: make(chan []*http.Cookie, 1),
	}
	
	w32.PostMessage(w.hwnd, w32.WM_APP + 100, uintptr(unsafe.Pointer(req)), 0)

	return <-req.resultChan
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
