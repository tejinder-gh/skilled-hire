# Contractor Matching

The launch matcher is deterministic and explainable. Candidates are first filtered by active status, service area, vertical support, availability, and valid required credentials. They are ranked by distance, rating, completion rate, response time and workload. Its `MatchingEngine` interface permits a future ML implementation; human dispatch can override with an audit reason.
