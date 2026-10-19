import Foundation

// Mirrors docs/state-schema.md (v1), public fields only.

enum Source: String, Decodable, Sendable {
    case claude, codex, unknown
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

enum JobStatus: String, Decodable, Sendable {
    case planning, running, waiting, done, error, unknown
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

enum MilestoneStatus: String, Decodable, Sendable {
    case pending, active, done, unknown
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

enum PillKind: String, Decodable, Sendable {
    case ok, warn, active, info, unknown
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

enum AgentStatus: String, Decodable, Sendable {
    case running, done, error, stale, unknown
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

struct Milestone: Decodable, Sendable {
    let key: String
    let title: String
    let status: MilestoneStatus
}

struct Pill: Decodable, Sendable {
    let label: String
    let kind: PillKind
}

struct Now: Decodable, Sendable {
    let milestone: String
    let pills: [Pill]
    let attempt: Int
    let file: String?
}

struct Job: Decodable, Sendable {
    let id: String
    let seq: Int
    let title: String
    let summary: String
    let prompt: String
    let status: JobStatus
    let milestones: [Milestone]
    let startedAt: Date
    let updatedAt: Date
    let endedAt: Date?
    let now: Now?
}

struct Agent: Decodable, Sendable {
    let id: String
    let name: String
    let status: AgentStatus
    let activity: String
    let job: Int?
    /// When it was first seen; agents are listed in this order.
    let startedAt: Date
    let updatedAt: Date
    let endedAt: Date?
    /// What it was asked to do; `""` when unknown (and in files written before the field existed).
    let summary: String
    /// Its own plan; empty when it made none.
    let milestones: [Milestone]
    /// Its own story, the last 6 steps, oldest first.
    let steps: [Pill]

    private enum CodingKeys: String, CodingKey {
        case id, name, status, activity, job, startedAt, updatedAt, endedAt, summary, milestones, steps
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        status = try c.decode(AgentStatus.self, forKey: .status)
        activity = try c.decode(String.self, forKey: .activity)
        job = try c.decodeIfPresent(Int.self, forKey: .job)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        startedAt = try c.decodeIfPresent(Date.self, forKey: .startedAt) ?? updatedAt
        endedAt = try c.decodeIfPresent(Date.self, forKey: .endedAt)
        // Additive v1 fields: older files lack them.
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        milestones = try c.decodeIfPresent([Milestone].self, forKey: .milestones) ?? []
        steps = try c.decodeIfPresent([Pill].self, forKey: .steps) ?? []
    }
}

struct Session: Decodable, Sendable {
    let schema: Int
    let source: Source
    let sessionId: String
    let cwd: String
    let project: String
    let updatedAt: Date
    let jobs: [Job]
    let agents: [String: Agent]
}

struct JobItem: Identifiable, Sendable {
    let session: Session
    let job: Job
    var id: String { job.id }
}

enum SessionDecoder {
    static let supportedSchema = 1

    /// Returns nil on any decode error or when the file's schema is newer than supported.
    static func decode(_ data: Data) -> Session? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            if let d = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return d }
            if let d = try? Date.ISO8601FormatStyle().parse(string) { return d }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad ISO 8601 date: \(string)"))
        }
        guard let session = try? decoder.decode(Session.self, from: data),
              session.schema <= supportedSchema else { return nil }
        return session
    }
}
