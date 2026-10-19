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

/// The kind of work, for coloring. Optional everywhere it appears: missing or unknown values decode as nil.
enum Stage: String, Sendable, CaseIterable {
    case plan, analyse, dev, fix, review
}

extension KeyedDecodingContainer {
    /// A `Stage` field: nil when missing, null, not a string or not a known stage.
    func decodeStage(forKey key: Key) -> Stage? {
        ((try? decodeIfPresent(String.self, forKey: key)) ?? nil).flatMap(Stage.init(rawValue:))
    }

    /// An optional date that never fails the whole file: nil when missing, null or malformed.
    func decodeLenientDate(forKey key: Key) -> Date? {
        (try? decodeIfPresent(Date.self, forKey: key)) ?? nil
    }
}

struct Milestone: Decodable, Sendable {
    let key: String
    let title: String
    let status: MilestoneStatus
    let stage: Stage?
    /// When the step first became active (or done); missing in older files.
    let startedAt: Date?
    /// When it became done.
    let endedAt: Date?

    private enum CodingKeys: String, CodingKey { case key, title, status, stage, startedAt, endedAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        title = try c.decode(String.self, forKey: .title)
        status = try c.decode(MilestoneStatus.self, forKey: .status)
        stage = c.decodeStage(forKey: .stage)
        startedAt = c.decodeLenientDate(forKey: .startedAt)
        endedAt = c.decodeLenientDate(forKey: .endedAt)
    }
}

struct Pill: Decodable, Sendable {
    let label: String
    let kind: PillKind
    let stage: Stage?

    private enum CodingKeys: String, CodingKey { case label, kind, stage }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decode(String.self, forKey: .label)
        kind = try c.decode(PillKind.self, forKey: .kind)
        stage = c.decodeStage(forKey: .stage)
    }
}

struct Now: Decodable, Sendable {
    let milestone: String
    let pills: [Pill]
    let attempt: Int
    let file: String?
    /// What kind of work the main agent is doing now.
    let stage: Stage?

    private enum CodingKeys: String, CodingKey { case milestone, pills, attempt, file, stage }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        milestone = try c.decode(String.self, forKey: .milestone)
        pills = try c.decode([Pill].self, forKey: .pills)
        attempt = try c.decode(Int.self, forKey: .attempt)
        file = try c.decodeIfPresent(String.self, forKey: .file)
        stage = c.decodeStage(forKey: .stage)
    }
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
    /// Its current stage, as `Now.stage`.
    let stage: Stage?

    private enum CodingKeys: String, CodingKey {
        case id, name, status, activity, job, startedAt, updatedAt, endedAt, summary, milestones, steps, stage
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
        stage = c.decodeStage(forKey: .stage)
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
