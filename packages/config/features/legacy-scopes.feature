Feature: A scope at the old path is reported, never moved
  Factory keeps its files under `.xaedalon/` now, beside whatever else the
  Xaedalon family writes into a repository. Everything already at `.factory`
  still works — it is read exactly as before — and doctor says so, once, with
  the command that finishes the job.

  Reported rather than migrated on purpose. It is somebody's repository, their
  database is inside it, and a tool that quietly relocates either is a tool
  nobody should trust with the other.

  Background:
    Given the built-in doctor rules are registered

  Scenario: A user scope at the old path is reported
    Given a user scope at the old path
    When doctor runs
    Then doctor reports a scope at the old path
    And the report names where to move it

  Scenario: A project scope at the old path is reported
    Given a project scope at the old path
    When doctor runs
    Then doctor reports a scope at the old path

  Scenario: Scopes at the new path are not reported
    Given a user scope at the new path
    When doctor runs
    Then doctor says nothing about scope paths

  Scenario: A scope that is not there is not reported
    Given a user scope at the old path that does not exist
    When doctor runs
    Then doctor says nothing about scope paths
