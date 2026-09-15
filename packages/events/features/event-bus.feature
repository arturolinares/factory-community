Feature: The event bus
  Core publishes facts about what it has done. Anything that wants to react
  subscribes — the daemon, doctor, a third-party plugin, factory-pro's desktop
  capability. Nothing that subscribes can change what core did, and nothing
  that subscribes can stop core from working.

  Scenario: A subscriber receives the event it asked for
    Given a subscriber to "definition.created"
    When "definition.created" is published for the workflow "development"
    Then the subscriber received 1 event
    And the received event names the workflow "development"
    And the received event carries a timestamp

  Scenario: A subscriber is not told about other events
    Given a subscriber to "definition.created"
    When "definition.deleted" is published for the workflow "development"
    Then the subscriber received 0 events

  Scenario: A wildcard subscriber receives every event
    Given a subscriber to every event
    When "definition.created" is published for the workflow "development"
    And "definition.deleted" is published for the workflow "release"
    Then the subscriber received 2 events

  Scenario: Unsubscribing stops delivery
    Given a subscriber to "definition.created"
    When the subscriber unsubscribes
    And "definition.created" is published for the workflow "development"
    Then the subscriber received 0 events

  Scenario: A one-shot subscriber is delivered exactly once
    Given a one-shot subscriber to "definition.created"
    When "definition.created" is published for the workflow "development"
    And "definition.created" is published for the workflow "release"
    Then the subscriber received 1 event
    And the received event names the workflow "development"

  Scenario: A subscriber that throws does not break the publisher
    Given a subscriber to "definition.created" that throws
    And a subscriber to "definition.created"
    When "definition.created" is published for the workflow "development"
    Then publishing did not throw
    And the error was reported once
    And the subscriber received 1 event

  Scenario: A subscriber added while an event is being delivered does not receive it
    Given a subscriber to "definition.created" that subscribes another on delivery
    When "definition.created" is published for the workflow "development"
    Then the late subscriber received 0 events
