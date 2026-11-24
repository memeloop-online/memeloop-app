Feature: MemeLoop application launch
  As a user
  I want to launch MemeLoop successfully
  So that I can use the application

  @smoke @logging
  Scenario: Application starts, shows interface, and logs work
    When I launch the MemeLoop application
    And I wait for the page to load completely
    And I should see a "page body" element with selector "body"
    And the window title should contain "MemeLoop Desktop"
    # Verify renderer logging works by navigating to preferences
    When I click on a "settings button" element with selector "#open-preferences-button"
    When I switch to "preferences" window
    When I click on a "general section" element with selector "[data-testid='preference-section-general']"
    Then I should find log entries containing
      | test-id-Preferences section clicked |
