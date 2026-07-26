Feature: Agent Workflow - Tool Usage and Multi-Round Conversation
  As a user
  I want to use an intelligent agent to search wiki content
  So that I can get AI-powered explanations of wiki entries

  Background:
    Given I add test ai settings
    # Start mock OpenAI server with no rules - rules will be added per scenario
    And I have started the mock OpenAI server without rules
    Then I launch the TidGi application
    And I wait for the page to load completely
    And I should see a "page body" element with selector "body"
    # A persisted Wiki workspace may be active from an earlier session. Agent
    # scenarios must explicitly enter the agent workspace instead of assuming
    # a fresh profile always starts there.
    And I click on an "agent workspace" element with selector "[data-testid='workspace-agent']"

  @agent
  Scenario: Create default agent from New Tab quick access
    When I click on "new tab button and create default agent button" elements with selectors:
      | element description         | selector                                    |
      | new tab button              | [data-tab-id='new-tab-button']              |
      | create default agent button | [data-testid='create-default-agent-button'] |
    And I should see a "message input box" element with selector "[data-testid='agent-message-input']"

  @agent
  Scenario: Close all tabs then create default agent from fallback page
    # Create a real closable tab first; a fresh profile already contains only
    # the non-closable New Tab entry.
    When I click on a "create default agent button" element with selector "[data-testid='create-default-agent-button']"
    And I should see a "message input box" element with selector "[data-testid='agent-message-input']"
    # Open tab list dropdown and force-click all close buttons (they have opacity: 0)
    Given I click on a "tab list button" element with selector "[data-testid='tab-list-button']"
    And I should see a "tab list dropdown" element with selector "[data-testid='tab-list-dropdown']"
    When I click all "tab close button" elements matching selector "[data-testid^='tab-close-']"
    # When there is no active tab, this is "fallback new tab", it has same thing as new tab.
    And I should see "new tab button and Create Default Agent" elements with selectors:
      | element description     | selector                                    |
      | new tab button          | [data-tab-id='new-tab-button']              |
      | Create Default Agent    | [data-testid='create-default-agent-button'] |
    When I click on a "new tab button" element with selector "[data-tab-id='new-tab-button']"
    And I should see a "Create Default Agent" element with selector "[data-testid='create-default-agent-button']"
    When I click on a "create default agent button" element with selector "[data-testid='create-default-agent-button']"
    And I should see a "message input box" element with selector "[data-testid='agent-message-input']"
    # Open dropdown again and close all tabs
    When I click on a "tab list button" element with selector "[data-testid='tab-list-button']"
    And I should see a "tab list dropdown" element with selector "[data-testid='tab-list-dropdown']"
    Then I click all "tab close button" elements matching selector "[data-testid^='tab-close-']"

  @agent @mockOpenAI
  Scenario: Streamed assistant response can be cancelled mid-stream and send button returns
    # Add scenario-specific responses to the mock server
    Given I add mock OpenAI responses:
      | response                                                                                               | stream |
      | partial_chunk_1<stream_split>partial_chunk_2<stream_split>partial_chunk_3<stream_split>partial_chunk_4 | true   |
    And I click on "new tab button and create default agent button" elements with selectors:
      | element description         | selector                                    |
      | new tab button              | [data-tab-id='new-tab-button']              |
      | create default agent button | [data-testid='create-default-agent-button'] |
    And I should see a "message input box" element with selector "[data-testid='agent-message-input']"
    When I click on a "message input textarea" element with selector "[data-testid='agent-message-input']"
    When I type "Start long streaming" in "chat input" element with selector "[data-testid='agent-message-input']"
    And I press "Enter" key
    # Wait for streaming container to appear and contain the first chunk
    Then I should see "assistant streaming container and partial assistant text and cancel icon" elements with selectors:
      | element description           | selector                                 |
      | assistant streaming container | [data-testid='assistant-streaming-text'] |
      | partial assistant text        | *:has-text('partial_chunk_1')            |
      | cancel icon                   | [data-testid='cancel-icon']              |
    # Click cancel button mid-stream
    When I click on a "cancel button" element with selector "[data-testid='agent-send-button']"
    # Verify send button returned and stream stopped (no further chunks)
    Then I should see "send icon and send button" elements with selectors:
      | element description | selector                         |
      | send icon           | [data-testid='send-icon']        |
      | send button         | [data-testid='agent-send-button']|
    And I should not see a "partial chunk 4 text" element with selector "text='partial_chunk_4'"
