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

    private let requests: [NetworkRequest] = [
        .init(title: "GET httpbin", method: .get, url: "https://httpbin.org/get"),
        .init(title: "POST JSON", method: .post(body: "{\"hello\":\"world\"}"), url: "https://httpbin.org/post"),
        .init(title: "Auth Challenge", method: .get, url: "https://httpbin.org/basic-auth/user/passwd", headers: ["Authorization": "Basic dXNlcjpwYXNzd2Q="]),
        .init(title: "Delay 2s", method: .get, url: "https://httpbin.org/delay/2"),
        .init(title: "Status 418", method: .get, url: "https://httpbin.org/status/418"),
        .init(title: "UUID", method: .get, url: "https://httpbin.org/uuid")
    ]

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                requestButtons
                Divider()
                logList
            }
            .padding()
            .navigationTitle("Network Playground")
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

    private var logList: some View {
        List(logs.sorted(by: { $0.timestamp > $1.timestamp })) { entry in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
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
            .padding(.vertical, 4)
        }
        .listStyle(.plain)
    }

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

        func truncate(_ string: String) -> String {
            if string.count > 80 {
                let prefix = string.prefix(80)
                return "\(prefix)..."
            }
            return string
        }
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
    let timestamp: Date
}

#Preview {
    ContentView()
}
