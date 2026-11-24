Feature: Persistent goals in the packaged desktop application
  @agentGoal
  Scenario: App goal explains a missing provider key and opens its settings
    Given I prepare an isolated goal model with "missing-key" replies
    When I launch the MemeLoop application
    And I wait for the page to load completely
    And I click on a "default agent" element with selector "[data-testid='create-default-agent-button']"
    Then I should see a "message input" element with selector "[data-testid='agent-message-input']"
    When I click on a "goal button" element with selector "button[aria-label='目标']"
    And I type "Verify the configured provider before working." in "goal objective" element with selector "[role='dialog'] textarea:not([readonly])"
    And I click on a "start goal" element with selector "[role='dialog'] button:has-text('开始目标')"
    Then I should see a "localized provider error" element with selector "[role='dialog'] [role='alert']:has-text('请在设置中检查 goal-test 的 API 密钥')"
    And I capture the App goal screenshot "goal-provider-error"
    When I click on a "provider settings action" element with selector "[role='dialog'] button:has-text('前往设置')"
    And I switch to "preferences" window
    Then I should see a "provider settings" element with selector "body:has-text('goal-test')"
    And I focus the App goal provider key setting
    And I capture the App goal screenshot "goal-provider-settings"

  @agentGoal
  Scenario: App goal continues across two rounds and keeps its result after restart
    Given I prepare an isolated goal model with "completed" replies
    When I launch the MemeLoop application
    And I wait for the page to load completely
    And I click on a "default agent" element with selector "[data-testid='create-default-agent-button']"
    Then I should see a "message input" element with selector "[data-testid='agent-message-input']"
    When I click on a "goal button" element with selector "button[aria-label='目标']"
    And I type "APP_GOAL_ACCEPTANCE: Complete a two-round interface check." in "goal objective" element with selector "[role='dialog'] textarea:not([readonly])"
    And I click on a "start goal" element with selector "[role='dialog'] button:has-text('开始目标')"
    Then I should see a "completed goal" element with selector "[role='dialog'] .MuiChip-label:has-text('已完成')"
    And the App goal should persist 2 rounds with evidence "APP_GOAL_VERIFIED"
    And the next App goal round should receive the previous reply and its goal tool
    When I click on a "return to conversation" element with selector "[role='dialog'] button:has-text('返回')"
    Then I should see a "final reply" element with selector "[data-testid='message-bubble']:has-text('APP_GOAL_FINAL_RESULT')"
    And I should see a "localized work summary" element with selector "[data-testid='work-disclosure'] > summary:has-text('工作了 1 步')"
    When I close the MemeLoop application
    And I launch the MemeLoop application
    And I wait for the page to load completely
    And I click on a "goal button" element with selector "button[aria-label='目标']"
    Then I should see a "restored evidence" element with selector "[role='dialog'] p:has-text('APP_GOAL_VERIFIED')"
    And I capture the App goal screenshot "goal-restored"

  @agentGoal @agentLoopScript
  Scenario: App saved mjs loop completes its goal and persists its final reply
    Given I prepare an isolated goal model with "completed" replies
    When I launch the MemeLoop application
    And I wait for the page to load completely
    And I record App goal renderer diagnostics
    And I right-click on a "default definition" element with selector "[data-testid='create-default-agent-button']"
    And I click on an "edit definition" element with selector "[data-testid='edit-definition-menu-item']"
    Then I should see a "script source editor" element with selector ".MuiFormControl-root:has(> label:text-is('JavaScript 源码')) textarea:not([readonly])"
    When I clear text in "script source" element with selector ".MuiFormControl-root:has(> label:text-is('JavaScript 源码')) textarea:not([readonly])"
    And I type "export default async function run(ctx) { await ctx.goal.complete('APP_MJS_VERIFIED'); ctx.finish('APP_MJS_FINAL_RESULT'); }" in "script source" element with selector ".MuiFormControl-root:has(> label:text-is('JavaScript 源码')) textarea:not([readonly])"
    And I click on a "save script" element with selector "button:has-text('保存脚本')"
    Then I should see a "saved script notice" element with selector "[role='alert']:has-text('脚本已保存')"
    When I click on a "new conversation tab" element with selector "[data-tab-id='new-tab-button']"
    And I click on a "saved default agent" element with selector "[data-testid='create-default-agent-button']"
    Then I should see a "message input" element with selector "[data-testid='agent-message-input']"
    And I capture the App goal screenshot "script-conversation-created"
    When I click on a "goal button" element with selector "button[aria-label='目标']"
    And I type "Run the saved script and record its final result." in "goal objective" element with selector "[role='dialog'] textarea:not([readonly])"
    And I click on a "start goal" element with selector "[role='dialog'] button:has-text('开始目标')"
    Then I should see a "script completion evidence" element with selector "[role='dialog'] p:has-text('APP_MJS_VERIFIED')"
    And the App goal should persist 1 rounds with evidence "APP_MJS_VERIFIED"
    When I click on a "return to conversation" element with selector "[role='dialog'] button:has-text('返回')"
    Then I should see a "script final reply" element with selector "[data-testid='message-bubble']:has-text('APP_MJS_FINAL_RESULT')"
    When I close the MemeLoop application
    And I launch the MemeLoop application
    And I wait for the page to load completely
    Then I should see a "restored script reply" element with selector "[data-testid='message-bubble']:has-text('APP_MJS_FINAL_RESULT')"
    And I capture the App goal screenshot "script-final-restored"

  @agentGoal
  Scenario: App streaming goal stays paused across a window reload and resumes
    Given I prepare an isolated goal model with "paused" replies
    When I launch the MemeLoop application
    And I wait for the page to load completely
    And I click on a "default agent" element with selector "[data-testid='create-default-agent-button']"
    Then I should see a "message input" element with selector "[data-testid='agent-message-input']"
    When I click on a "goal button" element with selector "button[aria-label='目标']"
    And I type "APP_GOAL_PAUSE_ACCEPTANCE" in "goal objective" element with selector "[role='dialog'] textarea:not([readonly])"
    And I click on a "start goal" element with selector "[role='dialog'] button:has-text('开始目标')"
    Then the App goal model should have received a request
    When I click on a "pause goal" element with selector "[role='dialog'] button:has-text('暂停')"
    Then I should see a "paused goal" element with selector "[role='dialog'] .MuiChip-label:has-text('已暂停')"
    When I click on a "return to conversation" element with selector "[role='dialog'] button:has-text('返回')"
    And I reload the goal conversation window
    And I click on a "goal button" element with selector "button[aria-label='目标']"
    Then I should see a "restored paused goal" element with selector "[role='dialog'] .MuiChip-label:has-text('已暂停')"
    When I click on a "resume goal" element with selector "[role='dialog'] button:has-text('继续')"
    Then I should see a "resumed evidence" element with selector "[role='dialog'] p:has-text('APP_GOAL_VERIFIED')"
    When I click on a "return to conversation" element with selector "[role='dialog'] button:has-text('返回')"
    Then I should see a "resumed final reply" element with selector "[data-testid='message-bubble']:has-text('APP_GOAL_FINAL_RESULT')"
    And I capture the App goal screenshot "goal-resumed"
