import { TextField, Snackbar } from "@amplication/design-system";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Form, Formik } from "formik";
import React, { useCallback, useContext } from "react";
import * as models from "../models";
import { useTracking } from "../util/analytics";
import { formatError } from "../util/error";
import FormikAutoSave from "../util/formikAutoSave";
import { validate } from "../util/formikValidateJsonSchema";
import PendingChangesContext from "../VersionControl/PendingChangesContext";
import { match } from "react-router-dom";
import "./ApplicationDatabaseSettingsForms.scss";
import { GET_RESOURCE_SETTINGS } from "./appSettings/GenerationSettingsForm";

type Props = {
  match: match<{ resource: string }>;
};

type TData = {
  updateAppSettings: models.AppSettings;
};

const FORM_SCHEMA = {
  required: ["dbHost", "dbUser", "dbPassword", "dbPort"],
  properties: {
    dbHost: {
      type: "string",
      minLength: 2,
    },
    dbUser: {
      type: "string",
      minLength: 2,
    },
    dbPassword: {
      type: "string",
      minLength: 2,
    },
    dbPort: {
      type: "integer",
      minLength: 4,
      maxLength: 5,
    },
    dbName: {
      type: "string",
    },
  },
};

const CLASS_NAME = "application-database-settings-form";

function ApplicationDatabaseSettingsForms({ match }: Props) {
  const resourceId = match.params.resource;
  const { data, error } = useQuery<{
    appSettings: models.AppSettings;
  }>(GET_RESOURCE_SETTINGS, {
    variables: {
      id: resourceId,
    },
  });
  const pendingChangesContext = useContext(PendingChangesContext);

  const { trackEvent } = useTracking();

  const [updateAppSettings, { error: updateError }] = useMutation<TData>(
    UPDATE_APP_SETTINGS,
    {
      onCompleted: (data) => {
        pendingChangesContext.addBlock(data.updateAppSettings.id);
      },
    }
  );

  const handleSubmit = useCallback(
    (data: models.AppSettings) => {
      const { dbHost, dbName, dbPassword, dbPort, dbUser, authProvider } = data;
      trackEvent({
        eventName: "updateAppSettings",
      });
      updateAppSettings({
        variables: {
          data: {
            dbHost,
            dbName,
            dbPassword,
            dbPort,
            dbUser,
            authProvider,
          },
          resourceId: resourceId,
        },
      }).catch(console.error);
    },
    [updateAppSettings, resourceId, trackEvent]
  );

  const errorMessage = formatError(error || updateError);
  return (
    <div className={CLASS_NAME}>
      {data?.appSettings && (
        <Formik
          initialValues={data.appSettings}
          validate={(values: models.AppSettings) =>
            validate(values, FORM_SCHEMA)
          }
          enableReinitialize
          onSubmit={handleSubmit}
        >
          {(formik) => {
            return (
              <Form>
                <div className={`${CLASS_NAME}__header`}>
                  <h3>Database Settings</h3>
                </div>
                <p className={`${CLASS_NAME}__description`}>
                  All the below settings will appear in clear text in the
                  generated resource. <br />
                  It should only be used for the development environment
                  variables and should not include sensitive data.
                </p>
                <FormikAutoSave debounceMS={2000} />
                <div className={`${CLASS_NAME}__formWrapper`}>
                  <TextField
                    className={`${CLASS_NAME}__formWrapper_field`}
                    name="dbHost"
                    autoComplete="off"
                    label="Host"
                  />
                  <TextField
                    className={`${CLASS_NAME}__formWrapper_field`}
                    name="dbName"
                    autoComplete="off"
                    label="Database Name"
                  />
                  <TextField
                    className={`${CLASS_NAME}__formWrapper_field`}
                    name="dbPort"
                    type="number"
                    autoComplete="off"
                    label="Port"
                  />
                  <TextField
                    className={`${CLASS_NAME}__formWrapper_field`}
                    name="dbUser"
                    autoComplete="off"
                    label="User"
                  />
                  <TextField
                    className={`${CLASS_NAME}__formWrapper_field`}
                    name="dbPassword"
                    autoComplete="off"
                    label="Password"
                  />
                </div>
              </Form>
            );
          }}
        </Formik>
      )}
      <Snackbar open={Boolean(error)} message={errorMessage} />
    </div>
  );
}

export default ApplicationDatabaseSettingsForms;

const UPDATE_APP_SETTINGS = gql`
  mutation updateAppSettings(
    $data: AppSettingsUpdateInput!
    $resourceId: String!
  ) {
    updateAppSettings(data: $data, where: { id: $resourceId }) {
      id
      dbHost
      dbName
      dbUser
      dbPassword
      dbPort
      authProvider
    }
  }
`;