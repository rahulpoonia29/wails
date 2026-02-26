//go:build linux && purego

package application

import "net/http"

func linuxGetCookies(_ *linuxWebviewWindow, _ string) []*http.Cookie {
	return nil
}
