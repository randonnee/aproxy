//
//  ContentView.swift
//  SampleApp
//
//  Created by Chase Zhou on 2/11/26.
//

import SwiftUI

struct ContentView: View {
    @State private var logs: [LogEntry] = []
    @State private var isPerforming = false
    @State private var wsClient = WebSocketClient()
    @State private var wsMessage = "Hello from Aproxy!"

    private let requests: [NetworkRequest] = [
        .init(title: "GET httpbin", method: .get, url: "https://httpbin.org/get"),
        .init(title: "POST JSON", method: .post(body: "{\"hello\":\"world\"}"), url: "https://httpbin.org/post"),
        .init(title: "Auth Challenge", method: .get, url: "https://httpbin.org/basic-auth/user/passwd", headers: ["Authorization": "Basic dXNlcjpwYXNzd2Q="]),
        .init(title: "Delay 2s", method: .get, url: "https://httpbin.org/delay/2"),
        .init(title: "Status 418", method: .get, url: "https://httpbin.org/status/418"),
        .init(title: "UUID", method: .get, url: "https://httpbin.org/uuid")
    ]

    private let wsEndpoints: [WSEndpoint] = [
        .init(title: "Echo (wss)", url: "wss://echo.websocket.org"),
        .init(title: "Echo (ws)", url: "ws://echo.websocket.org"),
        .init(title: "Postman Echo", url: "wss://ws.postman-echo.com/raw"),
    ]

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    // HTTP section
                    sectionHeader("HTTP Requests")
                    requestButtons

                    Divider()

                    // WebSocket section
                    sectionHeader("WebSocket")
                    wsControls

                    Divider()

                    // Logs
                    sectionHeader("Log")
                    logList
                }
                .padding()
            }
            .navigationTitle("Network Playground")
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Spacer()
        }
    }

    private var requestButtons: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(requests) { request in
                Button {
                    trigger(request)
                } label: {
                    VStack(spacing: 6) {
                        Text(request.title)
                            .font(.headline)
                            .multilineTextAlignment(.center)
                        Text(request.method.displayName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.blue.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .disabled(isPerforming)
            }
        }
    }

    private var wsControls: some View {
        VStack(spacing: 12) {
            // Endpoint picker buttons
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                ForEach(wsEndpoints) { endpoint in
                    Button {
                        connectWebSocket(to: endpoint)
                    } label: {
                        VStack(spacing: 6) {
                            Text(endpoint.title)
                                .font(.headline)
                                .multilineTextAlignment(.center)
                            Text("WS")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.cyan.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .disabled(wsClient.isConnected)
                }
            }

            // Connection status + disconnect
            if wsClient.isConnected {
                HStack(spacing: 12) {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 8, height: 8)
                    Text(wsClient.connectedUrl ?? "Connected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Button("Disconnect") {
                        disconnectWebSocket()
                    }
                    .font(.caption)
                    .foregroundStyle(.red)
                }
                .padding(.horizontal, 4)

                // Send message
                HStack(spacing: 8) {
                    TextField("Message", text: $wsMessage)
                        .textFieldStyle(.roundedBorder)
                        .font(.body)
                    Button("Send") {
                        sendWebSocketMessage()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(wsMessage.isEmpty)
                }
            }
        }
    }

    private var logList: some View {
        VStack(spacing: 0) {
            ForEach(logs.sorted(by: { $0.timestamp > $1.timestamp })) { entry in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        if entry.isWebSocket {
                            Text("WS")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.cyan)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        Text(entry.title)
                            .font(.headline)
                        Spacer()
                        Text(entry.status)
                            .font(.caption)
                            .foregroundStyle(entry.isError ? Color.red : Color.green)
                    }
                    Text(entry.details)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 4)
                Divider()
            }
        }
    }

    // MARK: - HTTP

    private func trigger(_ request: NetworkRequest) {
        isPerforming = true

        Task {
            do {
                let result = try await NetworkClient.perform(request: request)
                await MainActor.run {
                    logs.append(.init(title: request.title, status: "HTTP \(result.code)", details: truncate(result.body), isError: !(200..<300).contains(result.code), timestamp: Date()))
                    isPerforming = false
                }
            } catch {
                await MainActor.run {
                    logs.append(.init(title: request.title, status: "Error", details: error.localizedDescription, isError: true, timestamp: Date()))
                    isPerforming = false
                }
            }
        }
    }

    // MARK: - WebSocket

    private func connectWebSocket(to endpoint: WSEndpoint) {
        addLog(title: endpoint.title, status: "Connecting...", details: endpoint.url, isWebSocket: true)

        wsClient.connect(
            url: endpoint.url,
            onOpen: { protocol_ in
                addLog(title: endpoint.title, status: "Connected", details: "Protocol: \(protocol_ ?? "none")", isWebSocket: true)
            },
            onMessage: { message in
                addLog(title: endpoint.title, status: "Received", details: truncate(message), isWebSocket: true)
            },
            onClose: { code, reason in
                addLog(title: endpoint.title, status: "Closed (\(code))", details: reason ?? "No reason", isWebSocket: true)
            },
            onError: { error in
                addLog(title: endpoint.title, status: "Error", details: error, isError: true, isWebSocket: true)
            }
        )
    }

    private func disconnectWebSocket() {
        wsClient.disconnect()
    }

    private func sendWebSocketMessage() {
        let msg = wsMessage
        wsClient.send(message: msg)
        addLog(title: "Send", status: "Sent", details: truncate(msg), isWebSocket: true)
    }

    // MARK: - Helpers

    private func addLog(title: String, status: String, details: String, isError: Bool = false, isWebSocket: Bool = false) {
        logs.append(.init(title: title, status: status, details: details, isError: isError, isWebSocket: isWebSocket, timestamp: Date()))
    }

    private func truncate(_ string: String) -> String {
        if string.count > 80 {
            let prefix = string.prefix(80)
            return "\(prefix)..."
        }
        return string
    }
}

struct NetworkRequest: Identifiable {
    enum Method {
        case get
        case post(body: String)

        var displayName: String {
            switch self {
            case .get:
                return "GET"
            case .post:
                return "POST"
            }
        }
    }

    let id = UUID()
    let title: String
    let method: Method
    let url: String
    var headers: [String: String] = [:]
}

struct NetworkResult {
    let code: Int
    let body: String
}

enum NetworkClient {
    static func perform(request: NetworkRequest) async throws -> NetworkResult {
        guard let url = URL(string: request.url) else {
            throw URLError(.badURL)
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.displayName
        request.headers.forEach { key, value in
            urlRequest.addValue(value, forHTTPHeaderField: key)
        }

        if case let .post(body) = request.method {
            urlRequest.httpBody = body.data(using: .utf8)
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let httpResponse = response as? HTTPURLResponse
        let bodyString = String(data: data, encoding: .utf8) ?? "<binary>"
        return NetworkResult(code: httpResponse?.statusCode ?? -1, body: bodyString)
    }
}

struct LogEntry: Identifiable {
    let id = UUID()
    let title: String
    let status: String
    let details: String
    let isError: Bool
    var isWebSocket: Bool = false
    let timestamp: Date
}

// MARK: - WebSocket

struct WSEndpoint: Identifiable {
    let id = UUID()
    let title: String
    let url: String
}

@Observable
class WebSocketClient {
    private(set) var isConnected = false
    private(set) var connectedUrl: String?
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?

    private var onMessage: ((String) -> Void)?
    private var onClose: ((Int, String?) -> Void)?
    private var onError: ((String) -> Void)?

    func connect(
        url urlString: String,
        onOpen: @escaping (String?) -> Void,
        onMessage: @escaping (String) -> Void,
        onClose: @escaping (Int, String?) -> Void,
        onError: @escaping (String) -> Void
    ) {
        guard let url = URL(string: urlString) else {
            onError("Invalid URL: \(urlString)")
            return
        }

        self.onMessage = onMessage
        self.onClose = onClose
        self.onError = onError

        let delegate = WebSocketDelegate(
            onOpen: { [weak self] proto in
                DispatchQueue.main.async {
                    self?.isConnected = true
                    self?.connectedUrl = urlString
                    onOpen(proto)
                }
            },
            onClose: { [weak self] code, reason in
                DispatchQueue.main.async {
                    self?.isConnected = false
                    self?.connectedUrl = nil
                    onClose(code, reason)
                }
            }
        )

        session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        task = session?.webSocketTask(with: url)
        task?.resume()
        listenForMessages()
    }

    func send(message: String) {
        task?.send(.string(message)) { [weak self] error in
            if let error {
                DispatchQueue.main.async {
                    self?.onError?(error.localizedDescription)
                }
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: "User disconnected".data(using: .utf8))
        isConnected = false
        connectedUrl = nil
    }

    private func listenForMessages() {
        task?.receive { [weak self] result in
            switch result {
            case .success(let message):
                let text: String
                switch message {
                case .string(let str):
                    text = str
                case .data(let data):
                    text = String(data: data, encoding: .utf8) ?? "<binary \(data.count) bytes>"
                @unknown default:
                    text = "<unknown>"
                }
                DispatchQueue.main.async {
                    self?.onMessage?(text)
                }
                self?.listenForMessages()
            case .failure(let error):
                DispatchQueue.main.async {
                    if self?.isConnected == true {
                        self?.onError?(error.localizedDescription)
                        self?.isConnected = false
                        self?.connectedUrl = nil
                    }
                }
            }
        }
    }
}

class WebSocketDelegate: NSObject, URLSessionWebSocketDelegate {
    private let onOpen: (String?) -> Void
    private let onClose: (Int, String?) -> Void

    init(onOpen: @escaping (String?) -> Void, onClose: @escaping (Int, String?) -> Void) {
        self.onOpen = onOpen
        self.onClose = onClose
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        onOpen(`protocol`)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonString = reason.flatMap { String(data: $0, encoding: .utf8) }
        onClose(closeCode.rawValue, reasonString)
    }
}

#Preview {
    ContentView()
}
