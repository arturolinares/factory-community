Feature: Managing a definition once it exists
  Authoring is more than the first save. A definition gets renamed, replaced,
  deleted, and edited from two places at once — and each of those is a chance to
  lose work quietly.

  YAML here is a view, never an editor. Two ways to change one document means
  two sources of truth to reconcile on every switch, and the reconciliation is
  exactly where a hand-written comment gets dropped.

  Background:
    Given a project scope and a user scope

  Scenario: The file can be read instead of the form
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And I switch to the YAML view
    Then the file is shown
    And the form is not shown

  Scenario: Switching back returns to the form
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And I switch to the YAML view
    And I switch back to the form view
    Then the form is shown

  Scenario: A phase that does not exist is flagged where it is referenced
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And I add the phase "nowhere"
    Then "nowhere" is flagged as missing
    And I am offered to create it

  Scenario: A phase that does exist shows where it resolves from
    Given the project defines the phase "analysis"
    And the project defines the workflow "development"
    When I open the workflow "development"
    Then the phase reference "analysis" shows the project scope

  Scenario: Creating a missing phase opens beside the workflow, not instead of it
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And I add the phase "nowhere"
    And I follow the offer to create it
    Then the new phase page opens in a new tab
    And the name field there reads "nowhere"
    And the workflow I was editing is still open

  Scenario: Deleting goes back to the list and says so
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And I delete it
    Then the workflows list is open
    And it says the workflow was deleted

  Scenario: Deleting a copy that hid another says what is left
    Given the project defines the workflow "development"
    And the user also defines the workflow "development"
    When I open the workflow "development"
    And I delete it
    Then the workflows list is open
    And it says the workflow was deleted
    And it says the name still resolves from a lower scope

  Scenario: Deleting takes two clicks
    Given the project defines the workflow "development"
    When I open the workflow "development"
    Then the delete button asks for confirmation before doing anything

  Scenario: A new definition cannot be deleted
    When I open the new workflow page
    Then there is no delete button

  Scenario: A file edited elsewhere is not silently overwritten
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And someone else changes the file
    And I set the description to "Mine."
    And I save
    Then I am told the file changed on disk
    And I am shown what is there now
    And nothing was written

  Scenario: I can take the other version instead
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And someone else changes the file
    And I set the description to "Mine."
    And I save
    And I choose to discard mine and reload
    Then the description field reads "theirs"

  Scenario: I can overwrite deliberately
    Given the project defines the workflow "development"
    When I open the workflow "development"
    And someone else changes the file
    And I set the description to "Mine."
    And I save
    And I choose to overwrite
    Then I am back on the workflows list
    And the stored workflow says "Mine."

  Rule: the library separates what you wrote from what shipped

    Sorted into one table, `worktree-create` sat between two of your own
    workflows and only a badge told them apart.

    Scenario: Built-in definitions are listed separately
      Given the project defines the workflow "development"
      When I open the workflows list
      Then "development" is under "Yours"
      And "hello-world" is under "Built in"

  Rule: a loop says how many times

    Scenario: Repeat is offered once the mode is a loop
      When I open the new workflow page
      Then there is no repeat field
      When I set the mode to "loop"
      Then the repeat field is offered

    Scenario: A repeat outside the allowed range is brought back in
      When I open the new workflow page
      And I set the mode to "loop"
      And I set the repeat to "500"
      Then the preview says the repeat is 100

  Rule: a field that offers values looks like one

    Chromium hides a datalist's arrow until the pointer is over it, so a raw
    `<input list>` is a plain text box that happens to have a dropdown — which
    is how the phases picker came to look like there was no way to add a phase.

    Scenario: The phases picker draws its own arrow
      When I open the new workflow page
      Then the phases field has a visible arrow
      And the phases field offers the phases that exist
